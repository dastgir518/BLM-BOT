<?php

if (!defined('ABSPATH')) {
    exit;
}

class Biolec_Codex_Bot_Widget
{
    public static function init()
    {
        add_action('wp_enqueue_scripts', [__CLASS__, 'enqueue'], 100);
        add_action('wp_footer', [__CLASS__, 'render']);
    }

    public static function enqueue()
    {
        if (!self::is_enabled()) {
            return;
        }

        wp_enqueue_style(
            'biolec-codex-bot-fonts',
            'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=Source+Serif+4:wght@500;600&display=swap',
            [],
            null
        );

        wp_enqueue_style(
            'biolec-codex-bot-widget',
            BIOLEC_CODEX_BOT_URL . 'assets/chat-widget.css',
            ['biolec-codex-bot-fonts'],
            BIOLEC_CODEX_BOT_VERSION
        );

        wp_enqueue_script(
            'biolec-codex-bot-widget',
            BIOLEC_CODEX_BOT_URL . 'assets/chat-widget.js',
            [],
            BIOLEC_CODEX_BOT_VERSION,
            true
        );

        wp_localize_script('biolec-codex-bot-widget', 'BiolecCodexBot', [
            'chatUrl' => esc_url_raw(rest_url('biolec-codex-bot/v1/chat')),
            'styleUrl' => esc_url_raw(BIOLEC_CODEX_BOT_URL . 'assets/chat-widget.css'),
            'welcome' => '<p>Hi, I am Dastgir. I can help you find products, understand delivery, or check order questions.</p>'
        ]);
    }

    public static function render()
    {
        if (!self::is_enabled()) {
            return;
        }
        ?>
        <div id="biolec-codex-chat" class="biolec-chat" aria-live="polite">
            <div class="biolec-chat__teaser">
                <button class="biolec-chat__teaser-close" type="button" aria-label="Hide chat prompt">&times;</button>
                <span>Dastgir</span>
                <p>Need help choosing mobility products?</p>
            </div>
            <button class="biolec-chat__toggle" type="button" aria-expanded="false" aria-controls="biolec-chat-panel" aria-label="Open Dastgir chat">
                <span class="biolec-chat__pulse" aria-hidden="true"></span>
                <span class="biolec-chat__badge" aria-hidden="true">1</span>
                <svg class="biolec-chat__launcher-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path d="M5.5 6.75A3.75 3.75 0 0 1 9.25 3h5.5a3.75 3.75 0 0 1 3.75 3.75v5.2a3.75 3.75 0 0 1-3.75 3.75h-4.1l-4.2 3.55a.8.8 0 0 1-1.32-.61V15.4A3.75 3.75 0 0 1 3.5 11.95v-5.2Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"></path>
                    <path d="M8.4 9.2h7.2M8.4 12.1h4.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>
                </svg>
            </button>
            <div id="biolec-chat-panel" class="biolec-chat__panel" hidden>
                <div class="biolec-chat__header">
                    <div class="biolec-chat__brand">
                        <span class="biolec-chat__brand-mark">D</span>
                        <div>
                            <strong>Dastgir</strong>
                            <span><i></i>Bio-Lec assistant</span>
                        </div>
                    </div>
                    <button class="biolec-chat__close" type="button" aria-label="Close chat">
                        <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                            <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>
                        </svg>
                    </button>
                </div>
                <div class="biolec-chat__messages"></div>
                <div class="biolec-chat__prompts">
                    <button type="button" class="biolec-chat__prompt" data-prompt="I need help choosing a mobility scooter">
                        <span class="biolec-chat__prompt-icon">♿</span>
                        <span>Help me choose a mobility scooter</span>
                        <i aria-hidden="true">→</i>
                    </button>
                    <button type="button" class="biolec-chat__prompt" data-prompt="Show me folding wheelchairs">
                        <span class="biolec-chat__prompt-icon">▣</span>
                        <span>Show folding wheelchairs</span>
                        <i aria-hidden="true">→</i>
                    </button>
                    <button type="button" class="biolec-chat__prompt" data-prompt="How does delivery work?">
                        <span class="biolec-chat__prompt-icon">↗</span>
                        <span>Check delivery information</span>
                        <i aria-hidden="true">→</i>
                    </button>
                    <button type="button" class="biolec-chat__prompt" data-prompt="How do I claim VAT relief?">
                        <span class="biolec-chat__prompt-icon">%</span>
                        <span>Explain VAT relief</span>
                        <i aria-hidden="true">→</i>
                    </button>
                </div>
                <div class="biolec-chat__quick">
                    <button type="button" data-prompt="I need help choosing a mobility scooter">Mobility scooter</button>
                    <button type="button" data-prompt="Show me folding wheelchairs">Folding wheelchairs</button>
                    <button type="button" data-prompt="How does delivery work?">Delivery</button>
                    <button type="button" data-prompt="How do I claim VAT relief?">VAT relief</button>
                </div>
                <form class="biolec-chat__form">
                    <div class="biolec-chat__composer">
                        <textarea class="biolec-chat__input" rows="1" autocomplete="off" placeholder="Ask about products, delivery, or orders" aria-label="Message"></textarea>
                        <button class="biolec-chat__send" type="submit" aria-label="Send message">
                            <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                                <path d="M4 10h11M11 5l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
                            </svg>
                        </button>
                    </div>
                    <div class="biolec-chat__foot">
                        <span>Powered by Bio-Lec Mobility</span>
                        <span>Press Enter</span>
                    </div>
                </form>
            </div>
        </div>
        <?php
    }

    private static function is_enabled()
    {
        return (bool) get_option('biolec_codex_bot_widget_enabled') && (string) get_option('biolec_codex_bot_server_url') !== '';
    }
}
