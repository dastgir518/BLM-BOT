<?php
/**
 * Plugin Name: Mobi Bio-Lec BOT
 * Description: Mobi, the Bio Lec Mobility AI assistant — chat widget plus WooCommerce product sync to the Supabase vector index.
 * Version: 0.4.2
 * Author: Bio Lec Mobility
 */

if (!defined('ABSPATH')) {
    exit;
}

define('BIOLEC_CODEX_BOT_VERSION', '0.4.2');
define('BIOLEC_CODEX_BOT_OPTION_GROUP', 'biolec_codex_bot_options');
define('BIOLEC_CODEX_BOT_URL', plugin_dir_url(__FILE__));

require_once plugin_dir_path(__FILE__) . 'includes/class-biolec-codex-bot-admin.php';
require_once plugin_dir_path(__FILE__) . 'includes/class-biolec-codex-bot-sync.php';
require_once plugin_dir_path(__FILE__) . 'includes/class-biolec-codex-bot-rest.php';
require_once plugin_dir_path(__FILE__) . 'includes/class-biolec-codex-bot-widget.php';

add_action('plugins_loaded', function () {
    Biolec_Codex_Bot_Admin::init();
    Biolec_Codex_Bot_Sync::init();
    Biolec_Codex_Bot_Rest::init();
    Biolec_Codex_Bot_Widget::init();
});

register_activation_hook(__FILE__, function () {
    if (!get_option('biolec_codex_bot_sync_secret')) {
        update_option('biolec_codex_bot_sync_secret', wp_generate_password(48, true, true));
    }
});
