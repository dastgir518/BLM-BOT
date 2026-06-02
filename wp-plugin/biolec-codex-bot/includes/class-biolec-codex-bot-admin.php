<?php

if (!defined('ABSPATH')) {
    exit;
}

class Biolec_Codex_Bot_Admin
{
    public static function init()
    {
        add_action('admin_menu', [__CLASS__, 'add_menu']);
        add_action('admin_enqueue_scripts', [__CLASS__, 'enqueue']);
        add_action('admin_init', [__CLASS__, 'register_settings']);
        add_action('admin_post_biolec_codex_bot_test_sync', [__CLASS__, 'test_sync']);
        add_action('admin_post_biolec_codex_bot_test_connection', [__CLASS__, 'test_connection']);
        add_action('admin_post_biolec_codex_bot_sync_all_products', [__CLASS__, 'sync_all_products']);
        add_action('admin_post_biolec_codex_bot_sync_key_pages', [__CLASS__, 'sync_key_pages']);
        add_action('admin_post_biolec_codex_bot_reindex_catalog', [__CLASS__, 'reindex_catalog']);
    }

    public static function add_menu()
    {
        add_menu_page(
            'Bio Lec AI Bot',
            'Bio Lec AI Bot',
            'manage_options',
            'biolec-codex-bot',
            [__CLASS__, 'render_page'],
            'dashicons-format-chat',
            56
        );

        add_submenu_page(
            'biolec-codex-bot',
            'Bot Settings',
            'Settings',
            'manage_options',
            'biolec-codex-bot',
            [__CLASS__, 'render_page']
        );
    }

    public static function enqueue($hook)
    {
        if ($hook !== 'toplevel_page_biolec-codex-bot') {
            return;
        }

        wp_enqueue_style(
            'biolec-codex-bot-admin',
            BIOLEC_CODEX_BOT_URL . 'assets/admin.css',
            [],
            BIOLEC_CODEX_BOT_VERSION
        );

        wp_enqueue_script(
            'biolec-codex-bot-admin',
            BIOLEC_CODEX_BOT_URL . 'assets/admin.js',
            [],
            BIOLEC_CODEX_BOT_VERSION,
            true
        );

        wp_localize_script('biolec-codex-bot-admin', 'BiolecBotAdmin', [
            'restUrl' => esc_url_raw(rest_url('biolec-codex-bot/v1/admin')),
            'nonce' => wp_create_nonce('wp_rest')
        ]);
    }

    public static function register_settings()
    {
        register_setting(BIOLEC_CODEX_BOT_OPTION_GROUP, 'biolec_codex_bot_server_url', [
            'type' => 'string',
            'sanitize_callback' => 'esc_url_raw',
            'default' => ''
        ]);

        register_setting(BIOLEC_CODEX_BOT_OPTION_GROUP, 'biolec_codex_bot_sync_secret', [
            'type' => 'string',
            'sanitize_callback' => 'sanitize_text_field',
            'default' => ''
        ]);

        register_setting(BIOLEC_CODEX_BOT_OPTION_GROUP, 'biolec_codex_bot_enabled', [
            'type' => 'boolean',
            'sanitize_callback' => function ($value) {
                return (bool) $value;
            },
            'default' => false
        ]);

        register_setting(BIOLEC_CODEX_BOT_OPTION_GROUP, 'biolec_codex_bot_widget_enabled', [
            'type' => 'boolean',
            'sanitize_callback' => function ($value) {
                return (bool) $value;
            },
            'default' => false
        ]);

        register_setting(BIOLEC_CODEX_BOT_OPTION_GROUP, 'biolec_codex_bot_support_email', [
            'type' => 'string',
            'sanitize_callback' => function ($value) {
                $emails = array_filter(array_map('sanitize_email', array_map('trim', explode(',', (string) $value))));
                return implode(', ', $emails);
            },
            'default' => ''
        ]);

        register_setting(BIOLEC_CODEX_BOT_OPTION_GROUP, 'biolec_codex_bot_support_phone', [
            'type' => 'string',
            'sanitize_callback' => 'sanitize_text_field',
            'default' => ''
        ]);
    }

    public static function render_page()
    {
        if (!current_user_can('manage_options')) {
            return;
        }

        $last_result = get_transient('biolec_codex_bot_last_test');
        $last_error = get_transient('biolec_codex_bot_last_error');
        ?>
        <div class="wrap biolec-bot-admin">
            <h1>Bio Lec AI Bot</h1>

            <?php if ($last_result): ?>
                <div class="notice notice-info">
                    <p><?php echo esc_html($last_result); ?></p>
                </div>
            <?php endif; ?>

            <?php if ($last_error): ?>
                <div class="notice notice-error">
                    <p><?php echo esc_html($last_error); ?></p>
                </div>
            <?php endif; ?>

            <div class="biolec-bot-grid">
                <section class="biolec-bot-panel">
                    <h2>Connection</h2>
                    <p class="biolec-bot-muted">Connect WordPress to the local Node bot server and enable the storefront widget.</p>
                    <form method="post" action="options.php">
                        <?php settings_fields(BIOLEC_CODEX_BOT_OPTION_GROUP); ?>

                        <label class="biolec-bot-field">
                            <span>Bot server URL</span>
                            <input type="url" name="biolec_codex_bot_server_url" value="<?php echo esc_attr(get_option('biolec_codex_bot_server_url')); ?>" placeholder="https://bot.yourdomain.com">
                            <small>Use a public HTTPS URL that your WordPress host can reach. Localhost/127.0.0.1 only works when WordPress is running on the same machine as the bot server.</small>
                        </label>

                        <label class="biolec-bot-field">
                            <span>Sync secret</span>
                            <input type="text" name="biolec_codex_bot_sync_secret" value="<?php echo esc_attr(get_option('biolec_codex_bot_sync_secret')); ?>">
                            <small>Must match BIOLEC_SYNC_SECRET on the Node bot server.</small>
                        </label>

                        <label class="biolec-bot-toggle">
                            <input type="checkbox" name="biolec_codex_bot_enabled" value="1" <?php checked(get_option('biolec_codex_bot_enabled'), true); ?>>
                            <span>Instant product/page push sync</span>
                        </label>

                        <label class="biolec-bot-toggle">
                            <input type="checkbox" name="biolec_codex_bot_widget_enabled" value="1" <?php checked(get_option('biolec_codex_bot_widget_enabled'), true); ?>>
                            <span>Storefront chat widget</span>
                        </label>

                        <label class="biolec-bot-field">
                            <span>Support team email</span>
                            <input type="text" name="biolec_codex_bot_support_email" value="<?php echo esc_attr(get_option('biolec_codex_bot_support_email')); ?>" placeholder="<?php echo esc_attr(get_option('admin_email')); ?>">
                            <small>Where chat handoff requests are emailed. Separate multiple addresses with commas. Defaults to the site admin email.</small>
                        </label>

                        <label class="biolec-bot-field">
                            <span>Support phone number</span>
                            <input type="text" name="biolec_codex_bot_support_phone" value="<?php echo esc_attr(get_option('biolec_codex_bot_support_phone')); ?>" placeholder="e.g. 0800 123 4567">
                            <small>Shown in the chat next to "Talk to a team member" so customers can call. Leave blank to hide.</small>
                        </label>

                        <div class="biolec-bot-actions">
                            <?php submit_button('Save Settings', 'primary', 'submit', false); ?>
                        </div>
                    </form>

                    <?php self::render_action_button('biolec_codex_bot_test_connection', 'Test Bot Server Connection'); ?>
                </section>

                <section class="biolec-bot-panel">
                    <h2>Catalog Sync</h2>
                    <p class="biolec-bot-muted">Use these once for setup or repair. Future product edits sync instantly when push sync is enabled.</p>
                    <div class="biolec-bot-stack">
                        <button type="button" class="button button-primary" data-biolec-action="sync-catalog">Sync Current Catalog</button>
                        <button type="button" class="button" data-biolec-action="sync-pages">Sync Key Pages</button>
                        <button type="button" class="button biolec-danger" data-biolec-action="reindex-catalog">Clear & Reindex Catalog</button>
                        <button type="button" class="button" data-biolec-action="cancel" disabled>Cancel</button>
                        <?php self::render_action_button('biolec_codex_bot_test_sync', 'Test First Product Sync'); ?>
                    </div>
                    <div class="biolec-progress" hidden>
                        <div class="biolec-progress__meta">
                            <strong class="biolec-progress__title">Preparing sync...</strong>
                            <span class="biolec-progress__count">0 / 0</span>
                        </div>
                        <div class="biolec-progress__bar" aria-hidden="true">
                            <span style="width: 0%"></span>
                        </div>
                        <p class="biolec-progress__status">Ready.</p>
                        <div class="biolec-progress__errors" hidden></div>
                    </div>
                </section>
            </div>
        </div>
        <?php
    }

    private static function render_action_button($action, $label, $class = 'secondary')
    {
        ?>
        <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" class="biolec-bot-inline-form">
            <?php wp_nonce_field($action); ?>
            <input type="hidden" name="action" value="<?php echo esc_attr($action); ?>">
            <?php submit_button($label, $class, 'submit', false); ?>
        </form>
        <?php
    }

    public static function test_connection()
    {
        if (!current_user_can('manage_options')) {
            wp_die('Unauthorized');
        }

        check_admin_referer('biolec_codex_bot_test_connection');

        $server_url = rtrim((string) get_option('biolec_codex_bot_server_url'), '/');
        if (!$server_url) {
            set_transient('biolec_codex_bot_last_test', 'Bot server URL is missing.', 30);
            wp_safe_redirect(self::admin_url());
            exit;
        }

        $response = wp_remote_get($server_url . '/health', [
            'timeout' => 15
        ]);

        if (is_wp_error($response)) {
            set_transient('biolec_codex_bot_last_test', 'Connection failed: ' . self::connection_error_message($server_url, $response->get_error_message()), 30);
            wp_safe_redirect(self::admin_url());
            exit;
        }

        $code = wp_remote_retrieve_response_code($response);
        $body = wp_remote_retrieve_body($response);

        if ($code >= 200 && $code < 300) {
            set_transient('biolec_codex_bot_last_test', 'Bot server connected successfully: ' . $body, 30);
        } else {
            set_transient('biolec_codex_bot_last_test', 'Connection failed with HTTP ' . $code . ': ' . $body, 30);
        }

        wp_safe_redirect(self::admin_url());
        exit;
    }

    public static function test_sync()
    {
        if (!current_user_can('manage_options')) {
            wp_die('Unauthorized');
        }

        check_admin_referer('biolec_codex_bot_test_sync');

        $products = wc_get_products([
            'limit' => 1,
            'status' => ['publish']
        ]);

        if (empty($products)) {
            set_transient('biolec_codex_bot_last_test', 'No WooCommerce products found.', 30);
            wp_safe_redirect(self::admin_url());
            exit;
        }

        $result = Biolec_Codex_Bot_Sync::push_product($products[0]->get_id(), true);
        set_transient('biolec_codex_bot_last_test', $result ? 'Test product sync sent.' : 'Test product sync failed. Check WooCommerce logs.', 30);
        wp_safe_redirect(self::admin_url());
        exit;
    }

    public static function sync_all_products()
    {
        if (!current_user_can('manage_options')) {
            wp_die('Unauthorized');
        }

        check_admin_referer('biolec_codex_bot_sync_all_products');

        $products = wc_get_products([
            'limit' => -1,
            'status' => ['publish'],
            'return' => 'ids'
        ]);

        $sent = 0;
        $failed = 0;
        foreach ($products as $product_id) {
            if (Biolec_Codex_Bot_Sync::push_product($product_id, true)) {
                $sent++;
            } else {
                $failed++;
            }
        }

        set_transient('biolec_codex_bot_last_test', 'Catalog sync complete. Sent: ' . $sent . '. Failed: ' . $failed . '.', 60);
        wp_safe_redirect(self::admin_url());
        exit;
    }

    public static function sync_key_pages()
    {
        if (!current_user_can('manage_options')) {
            wp_die('Unauthorized');
        }

        check_admin_referer('biolec_codex_bot_sync_key_pages');

        $slugs = Biolec_Codex_Bot_Sync::key_page_slugs();

        $sent = 0;
        $failed = 0;
        foreach ($slugs as $slug) {
            $page = get_page_by_path($slug);
            if (!$page) {
                continue;
            }

            if (Biolec_Codex_Bot_Sync::push_page($page->ID, true)) {
                $sent++;
            } else {
                $failed++;
            }
        }

        $error = get_transient('biolec_codex_bot_last_error');
        $message = 'Page sync complete. Sent: ' . $sent . '. Failed: ' . $failed . '.';
        if ($error) {
            $message .= ' Last error: ' . $error;
        }
        set_transient('biolec_codex_bot_last_test', $message, 60);
        wp_safe_redirect(self::admin_url());
        exit;
    }

    public static function reindex_catalog()
    {
        if (!current_user_can('manage_options')) {
            wp_die('Unauthorized');
        }

        check_admin_referer('biolec_codex_bot_reindex_catalog');

        $cleared_products = Biolec_Codex_Bot_Sync::clear_products(true);
        $products = wc_get_products([
            'limit' => -1,
            'status' => ['publish'],
            'return' => 'ids'
        ]);

        $sent = 0;
        $failed = 0;
        foreach ($products as $product_id) {
            if (Biolec_Codex_Bot_Sync::push_product($product_id, true)) {
                $sent++;
            } else {
                $failed++;
            }
        }

        $message = $cleared_products ? 'Catalog cleared and reindexed. ' : 'Catalog clear failed, attempted reindex anyway. ';
        $message .= 'Sent: ' . $sent . '. Failed: ' . $failed . '.';
        set_transient('biolec_codex_bot_last_test', $message, 60);
        wp_safe_redirect(self::admin_url());
        exit;
    }

    private static function admin_url()
    {
        return admin_url('admin.php?page=biolec-codex-bot');
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
