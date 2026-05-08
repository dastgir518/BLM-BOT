<?php

if (!defined('ABSPATH')) {
    exit;
}

class Biolec_Codex_Bot_Rest
{
    public static function init()
    {
        add_action('rest_api_init', [__CLASS__, 'register_routes']);
    }

    public static function register_routes()
    {
        register_rest_route('biolec-codex-bot/v1', '/chat', [
            'methods' => 'POST',
            'callback' => [__CLASS__, 'chat'],
            'permission_callback' => '__return_true',
            'args' => [
                'session_id' => [
                    'type' => 'string',
                    'required' => false,
                    'sanitize_callback' => 'sanitize_text_field'
                ],
                'message' => [
                    'type' => 'string',
                    'required' => true,
                    'sanitize_callback' => 'sanitize_textarea_field'
                ],
                'current_url' => [
                    'type' => 'string',
                    'required' => false,
                    'sanitize_callback' => 'esc_url_raw'
                ],
                'current_title' => [
                    'type' => 'string',
                    'required' => false,
                    'sanitize_callback' => 'sanitize_text_field'
                ]
            ]
        ]);

        register_rest_route('biolec-codex-bot/v1', '/admin/catalog-ids', [
            'methods' => 'GET',
            'callback' => [__CLASS__, 'catalog_ids'],
            'permission_callback' => [__CLASS__, 'admin_permission']
        ]);

        register_rest_route('biolec-codex-bot/v1', '/admin/sync-products', [
            'methods' => 'POST',
            'callback' => [__CLASS__, 'sync_products'],
            'permission_callback' => [__CLASS__, 'admin_permission'],
            'args' => [
                'ids' => [
                    'type' => 'array',
                    'required' => true
                ]
            ]
        ]);

        register_rest_route('biolec-codex-bot/v1', '/admin/sync-pages', [
            'methods' => 'POST',
            'callback' => [__CLASS__, 'sync_pages'],
            'permission_callback' => [__CLASS__, 'admin_permission']
        ]);

        register_rest_route('biolec-codex-bot/v1', '/admin/clear-products', [
            'methods' => 'POST',
            'callback' => [__CLASS__, 'clear_products'],
            'permission_callback' => [__CLASS__, 'admin_permission']
        ]);
    }

    public static function admin_permission()
    {
        return current_user_can('manage_options');
    }

    public static function catalog_ids()
    {
        $ids = wc_get_products([
            'limit' => -1,
            'status' => ['publish', 'draft', 'private'],
            'return' => 'ids'
        ]);

        return new WP_REST_Response([
            'ids' => array_values(array_map('intval', $ids)),
            'total' => count($ids)
        ], 200);
    }

    public static function sync_products(WP_REST_Request $request)
    {
        $ids = array_map('intval', (array) $request->get_param('ids'));
        $sent = 0;
        $failed = 0;
        $errors = [];

        foreach ($ids as $id) {
            if (Biolec_Codex_Bot_Sync::push_product($id, true)) {
                $sent++;
            } else {
                $failed++;
                $error = get_transient('biolec_codex_bot_last_error');
                if ($error) {
                    $errors[] = [
                        'id' => $id,
                        'error' => $error
                    ];
                }
            }
        }

        return new WP_REST_Response([
            'sent' => $sent,
            'failed' => $failed,
            'errors' => $errors
        ], 200);
    }

    public static function sync_pages()
    {
        $slugs = Biolec_Codex_Bot_Sync::key_page_slugs();
        $sent = 0;
        $failed = 0;
        $missing = [];
        $errors = [];

        foreach ($slugs as $slug) {
            $page = get_page_by_path($slug);
            if (!$page) {
                $missing[] = $slug;
                continue;
            }

            if (Biolec_Codex_Bot_Sync::push_page($page->ID, true)) {
                $sent++;
            } else {
                $failed++;
                $error = get_transient('biolec_codex_bot_last_error');
                if ($error) {
                    $errors[] = [
                        'slug' => $slug,
                        'error' => $error
                    ];
                }
            }
        }

        return new WP_REST_Response([
            'sent' => $sent,
            'failed' => $failed,
            'missing' => $missing,
            'errors' => $errors
        ], 200);
    }

    public static function clear_products()
    {
        return new WP_REST_Response([
            'ok' => Biolec_Codex_Bot_Sync::clear_products(true)
        ], 200);
    }

    public static function chat(WP_REST_Request $request)
    {
        $server_url = rtrim((string) get_option('biolec_codex_bot_server_url'), '/');
        if (!$server_url) {
            return new WP_REST_Response([
                'error' => 'Bot server URL is not configured.'
            ], 500);
        }

        $payload = [
            'session_id' => $request->get_param('session_id'),
            'message' => $request->get_param('message'),
            'current_url' => $request->get_param('current_url'),
            'current_title' => $request->get_param('current_title')
        ];

        $response = wp_remote_post($server_url . '/chat', [
            'timeout' => 120,
            'headers' => [
                'Content-Type' => 'application/json'
            ],
            'body' => wp_json_encode($payload)
        ]);

        if (is_wp_error($response)) {
            $message = $response->get_error_message();
            return new WP_REST_Response([
                'error' => 'Could not connect to the assistant server: ' . self::connection_error_message($server_url, $message),
                'detail' => $message
            ], 502);
        }

        $code = wp_remote_retrieve_response_code($response);
        $body = json_decode(wp_remote_retrieve_body($response), true);

        if ($code < 200 || $code >= 300) {
            $detail = is_array($body) ? wp_json_encode($body) : wp_remote_retrieve_body($response);
            return new WP_REST_Response([
                'error' => 'Assistant server returned HTTP ' . $code . ': ' . $detail,
                'detail' => $detail
            ], $code);
        }

        return new WP_REST_Response(is_array($body) ? $body : [
            'answer' => wp_remote_retrieve_body($response)
        ], 200);
    }

    private static function connection_error_message($server_url, $message)
    {
        $host = wp_parse_url($server_url, PHP_URL_HOST);
        $local_hosts = ['localhost', '127.0.0.1', '::1'];

        if ($host && in_array(strtolower($host), $local_hosts, true)) {
            return $message . ' The configured bot URL is local to the WordPress server. If this WordPress site is hosted online, set Bot server URL to a public HTTPS address for the Node bot server.';
        }

        return $message;
    }
}
