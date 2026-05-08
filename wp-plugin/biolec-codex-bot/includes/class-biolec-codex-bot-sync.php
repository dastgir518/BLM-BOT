<?php

if (!defined('ABSPATH')) {
    exit;
}

class Biolec_Codex_Bot_Sync
{
    public static function init()
    {
        add_action('woocommerce_update_product', [__CLASS__, 'push_product'], 20, 1);
        add_action('woocommerce_new_product', [__CLASS__, 'push_product'], 20, 1);
        add_action('save_post_page', [__CLASS__, 'push_page'], 20, 1);
        add_action('before_delete_post', [__CLASS__, 'maybe_delete_product'], 20, 1);
        add_action('before_delete_post', [__CLASS__, 'maybe_delete_page'], 20, 1);
        add_action('woocommerce_product_set_stock_status', [__CLASS__, 'push_product'], 20, 1);
    }

    public static function push_product($product_id, $force = false)
    {
        if (!$force && !self::is_enabled()) {
            return false;
        }

        if (!function_exists('wc_get_product')) {
            return false;
        }

        $product = wc_get_product($product_id);
        if (!$product) {
            return false;
        }

        $payload = self::build_product_payload($product);
        return self::send('/wp-sync/product-upsert', $payload);
    }

    public static function maybe_delete_product($post_id)
    {
        if (get_post_type($post_id) !== 'product') {
            return false;
        }

        if (!self::is_enabled()) {
            return false;
        }

        return self::send('/wp-sync/product-delete', [
            'event' => 'product.deleted',
            'product_id' => (int) $post_id
        ]);
    }

    public static function push_page($page_id, $force = false)
    {
        if (!$force && !self::is_enabled()) {
            return false;
        }

        $post = get_post($page_id);
        if (!$post || $post->post_type !== 'page') {
            return false;
        }

        if (wp_is_post_revision($page_id) || $post->post_status === 'auto-draft') {
            return false;
        }

        $payload = [
            'event' => 'page.updated',
            'page_id' => (int) $post->ID,
            'slug' => $post->post_name,
            'title' => get_the_title($post),
            'url' => get_permalink($post),
            'content' => apply_filters('the_content', $post->post_content),
            'updated_at' => gmdate('c', get_post_modified_time('U', true, $post->ID))
        ];

        return self::send('/wp-sync/page-upsert', $payload);
    }

    public static function maybe_delete_page($post_id)
    {
        if (get_post_type($post_id) !== 'page') {
            return false;
        }

        if (!self::is_enabled()) {
            return false;
        }

        return self::send('/wp-sync/page-delete', [
            'event' => 'page.deleted',
            'page_id' => (int) $post_id
        ]);
    }

    public static function clear_products($force = false)
    {
        if (!$force && !self::is_enabled()) {
            return false;
        }

        return self::send('/wp-sync/products-clear', [
            'event' => 'products.clear'
        ]);
    }

    public static function clear_pages($force = false)
    {
        if (!$force && !self::is_enabled()) {
            return false;
        }

        return self::send('/wp-sync/pages-clear', [
            'event' => 'pages.clear'
        ]);
    }

    public static function key_page_slugs()
    {
        return [
            'delivery',
            'returns',
            'refund-policy',
            'vat-relief',
            'contact',
            'terms-and-conditions',
            'privacy-policy'
        ];
    }

    private static function build_product_payload($product)
    {
        $post = get_post($product->get_id());
        $category_names = wp_get_post_terms($product->get_id(), 'product_cat', ['fields' => 'names']);
        $tag_names = wp_get_post_terms($product->get_id(), 'product_tag', ['fields' => 'names']);
        $taxonomies = self::product_taxonomies($product->get_id());

        $attributes = [];
        foreach ($product->get_attributes() as $attribute) {
            if ($attribute->is_taxonomy()) {
                $attributes[] = [
                    'name' => wc_attribute_label($attribute->get_name()),
                    'options' => wc_get_product_terms($product->get_id(), $attribute->get_name(), ['fields' => 'names'])
                ];
            } else {
                $attributes[] = [
                    'name' => $attribute->get_name(),
                    'options' => $attribute->get_options()
                ];
            }
        }

        $images = [];
        $image_id = $product->get_image_id();
        if ($image_id) {
            $images[] = wp_get_attachment_url($image_id);
        }
        foreach ($product->get_gallery_image_ids() as $gallery_id) {
            $images[] = wp_get_attachment_url($gallery_id);
        }

        $variations = [];
        if ($product->is_type('variable')) {
            foreach ($product->get_children() as $variation_id) {
                $variation = wc_get_product($variation_id);
                if (!$variation) {
                    continue;
                }

                $variations[] = [
                    'variation_id' => $variation->get_id(),
                    'sku' => $variation->get_sku(),
                    'price' => $variation->get_price(),
                    'regular_price' => $variation->get_regular_price(),
                    'sale_price' => $variation->get_sale_price(),
                    'stock_status' => $variation->get_stock_status(),
                    'stock_quantity' => $variation->get_stock_quantity(),
                    'weight' => $variation->get_weight(),
                    'dimensions' => [
                        'length' => $variation->get_length(),
                        'width' => $variation->get_width(),
                        'height' => $variation->get_height()
                    ],
                    'attributes' => $variation->get_attributes(),
                    'meta_data' => self::product_meta_data($variation)
                ];
            }
        }

        return [
            'event' => 'product.updated',
            'product_id' => (int) $product->get_id(),
            'slug' => $post ? $post->post_name : '',
            'post_date' => $post ? gmdate('c', get_post_time('U', true, $post)) : null,
            'post_parent' => $post ? (int) $post->post_parent : 0,
            'menu_order' => $post ? (int) $post->menu_order : 0,
            'sku' => $product->get_sku(),
            'name' => $product->get_name(),
            'url' => get_permalink($product->get_id()),
            'type' => $product->get_type(),
            'status' => $product->get_status(),
            'featured' => $product->get_featured(),
            'catalog_visibility' => $product->get_catalog_visibility(),
            'price' => $product->get_price(),
            'regular_price' => $product->get_regular_price(),
            'sale_price' => $product->get_sale_price(),
            'price_html' => $product->get_price_html(),
            'stock_status' => $product->get_stock_status(),
            'stock_quantity' => $product->get_stock_quantity(),
            'manage_stock' => $product->get_manage_stock(),
            'backorders' => $product->get_backorders(),
            'sold_individually' => $product->get_sold_individually(),
            'weight' => $product->get_weight(),
            'dimensions' => [
                'length' => $product->get_length(),
                'width' => $product->get_width(),
                'height' => $product->get_height()
            ],
            'shipping_class' => $product->get_shipping_class(),
            'average_rating' => $product->get_average_rating(),
            'review_count' => $product->get_review_count(),
            'purchase_note' => $product->get_purchase_note(),
            'taxonomies' => $taxonomies,
            'categories' => is_wp_error($category_names) ? [] : array_values($category_names),
            'tags' => is_wp_error($tag_names) ? [] : array_values($tag_names),
            'short_description' => $product->get_short_description(),
            'description' => $product->get_description(),
            'attributes' => $attributes,
            'images' => array_values(array_filter($images)),
            'variations' => $variations,
            'meta_data' => self::product_meta_data($product),
            'raw_meta' => self::raw_post_meta($product->get_id()),
            'updated_at' => gmdate('c', get_post_modified_time('U', true, $product->get_id()))
        ];
    }

    private static function product_taxonomies($product_id)
    {
        $taxonomies = [];

        foreach (get_object_taxonomies('product') as $taxonomy) {
            $terms = wp_get_post_terms($product_id, $taxonomy, ['fields' => 'names']);
            if (!is_wp_error($terms) && !empty($terms)) {
                $taxonomies[$taxonomy] = array_values($terms);
            }
        }

        return $taxonomies;
    }

    private static function raw_post_meta($product_id)
    {
        $raw_meta = [];

        foreach (get_post_meta($product_id) as $key => $values) {
            $raw_meta[$key] = array_map([__CLASS__, 'maybe_unserialize_meta_value'], (array) $values);
        }

        return $raw_meta;
    }

    private static function maybe_unserialize_meta_value($value)
    {
        return self::normalize_meta_value(maybe_unserialize($value));
    }

    private static function product_meta_data($product)
    {
        $meta_data = [];

        foreach ($product->get_meta_data() as $meta) {
            $data = $meta->get_data();
            $meta_data[] = [
                'id' => isset($data['id']) ? (int) $data['id'] : null,
                'key' => isset($data['key']) ? (string) $data['key'] : '',
                'value' => self::normalize_meta_value($data['value'] ?? null)
            ];
        }

        return $meta_data;
    }

    private static function normalize_meta_value($value)
    {
        if (is_scalar($value) || $value === null) {
            return $value;
        }

        if (is_array($value)) {
            $normalized = [];
            foreach ($value as $key => $item) {
                $normalized[$key] = self::normalize_meta_value($item);
            }
            return $normalized;
        }

        if (is_object($value)) {
            if (method_exists($value, 'get_data')) {
                return self::normalize_meta_value($value->get_data());
            }

            return wp_json_encode($value);
        }

        return (string) $value;
    }

    private static function send($path, $payload)
    {
        $server_url = rtrim((string) get_option('biolec_codex_bot_server_url'), '/');
        $secret = (string) get_option('biolec_codex_bot_sync_secret');

        if (!$server_url || !$secret) {
            self::log('Bot server URL or sync secret missing.');
            return false;
        }

        $body = wp_json_encode($payload);
        $timestamp = (string) time();
        $signature = hash_hmac('sha256', $timestamp . '.' . $body, $secret);

        $response = wp_remote_post($server_url . $path, [
            'timeout' => 20,
            'headers' => [
                'Content-Type' => 'application/json',
                'X-Biolec-Timestamp' => $timestamp,
                'X-Biolec-Signature' => 'sha256=' . $signature
            ],
            'body' => $body
        ]);

        if (is_wp_error($response)) {
            self::log($response->get_error_message());
            set_transient('biolec_codex_bot_last_error', $response->get_error_message(), 120);
            return false;
        }

        $code = wp_remote_retrieve_response_code($response);
        if ($code < 200 || $code >= 300) {
            $message = 'Sync failed with HTTP ' . $code . ': ' . wp_remote_retrieve_body($response);
            self::log($message);
            set_transient('biolec_codex_bot_last_error', $message, 120);
            return false;
        }

        return true;
    }

    private static function is_enabled()
    {
        return (bool) get_option('biolec_codex_bot_enabled');
    }

    private static function log($message)
    {
        if (function_exists('wc_get_logger')) {
            wc_get_logger()->error($message, ['source' => 'biolec-codex-bot']);
            return;
        }

        error_log('[biolec-codex-bot] ' . $message);
    }
}
