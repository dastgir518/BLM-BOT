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
            'registerUrl' => esc_url_raw(rest_url('biolec-codex-bot/v1/register')),
            'handoffUrl' => esc_url_raw(rest_url('biolec-codex-bot/v1/handoff')),
            'styleUrl' => esc_url_raw(BIOLEC_CODEX_BOT_URL . 'assets/chat-widget.css'),
            'welcome' => '<p>Hi, I am Mobi. I can help you find products, understand delivery, or check order questions.</p>'
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
                <span>Mobi</span>
                <p>Need help choosing mobility products?</p>
            </div>
            <button class="biolec-chat__toggle" type="button" aria-expanded="false" aria-controls="biolec-chat-panel" aria-label="Open Mobi chat">
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
                        <span class="biolec-chat__brand-mark">M</span>
                        <div>
                            <strong>Mobi</strong>
                            <span><i></i>Bio-Lec assistant</span>
                        </div>
                    </div>
                    <button class="biolec-chat__a11y-toggle" type="button" aria-label="Accessibility: read aloud and text size" aria-expanded="false">
                        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                            <path d="M4 9v6h4l5 4V5L8 9H4Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"></path>
                            <path d="M16.5 8.5a4.5 4.5 0 0 1 0 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>
                        </svg>
                        <span>Accessibility</span>
                    </button>
                    <button class="biolec-chat__new" type="button" aria-label="Start new chat" title="New chat">
                        <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                            <path d="M10 4v12M4 10h12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>
                        </svg>
                    </button>
                    <button class="biolec-chat__close" type="button" aria-label="Close chat">
                        <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                            <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>
                        </svg>
                    </button>
                </div>
                <div class="biolec-chat__a11y" hidden>
                    <div class="biolec-chat__a11y-row">
                        <span>Text size</span>
                        <div class="biolec-chat__a11y-textsize" role="group" aria-label="Text size">
                            <button type="button" data-textsize="normal" aria-label="Normal text">A</button>
                            <button type="button" data-textsize="large" aria-label="Large text">A+</button>
                            <button type="button" data-textsize="larger" aria-label="Larger text">A++</button>
                        </div>
                    </div>
                    <label class="biolec-chat__a11y-row">
                        <span>High contrast</span>
                        <input type="checkbox" class="biolec-chat__a11y-contrast">
                    </label>
                    <label class="biolec-chat__a11y-row">
                        <span>Read replies aloud</span>
                        <input type="checkbox" class="biolec-chat__a11y-autoread">
                    </label>
                </div>
                <input class="biolec-chat__hp" type="text" name="company" tabindex="-1" autocomplete="off" aria-hidden="true">
                <form class="biolec-chat__start">
                    <strong>Start chat</strong>
                    <p class="biolec-chat__start-intro">Please enter your name and email to continue chatting with Mobi.</p>
                    <label>
                        <span>Name</span>
                        <input class="biolec-chat__start-name" type="text" autocomplete="name" required>
                    </label>
                    <label>
                        <span>Email</span>
                        <input class="biolec-chat__start-email" type="email" autocomplete="email" required>
                    </label>
                    <p class="biolec-chat__start-error" role="alert" hidden></p>
                    <button type="submit">Continue</button>
                </form>
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
                <form class="biolec-chat__handoff-form" hidden>
                    <strong>Talk to a team member</strong>
                    <p class="biolec-chat__handoff-intro">Leave your details and our team will get back to you by email or phone.</p>
                    <label>
                        <span>Name</span>
                        <input class="biolec-chat__handoff-name" type="text" autocomplete="name" required>
                    </label>
                    <label>
                        <span>Email</span>
                        <input class="biolec-chat__handoff-email" type="email" autocomplete="email" required>
                    </label>
                    <label>
                        <span>Phone (optional)</span>
                        <input class="biolec-chat__handoff-phone" type="tel" autocomplete="tel">
                    </label>
                    <label>
                        <span>How can we help? (optional)</span>
                        <textarea class="biolec-chat__handoff-message" rows="2"></textarea>
                    </label>
                    <p class="biolec-chat__handoff-error" role="alert" hidden></p>
                    <div class="biolec-chat__handoff-actions">
                        <button type="submit">Send to team</button>
                        <button type="button" class="biolec-chat__handoff-cancel">Cancel</button>
                    </div>
                </form>
                <form class="biolec-chat__form">
                    <div class="biolec-chat__composer">
                        <button class="biolec-chat__mic" type="button" aria-label="Speak your message" hidden>
                            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                                <path d="M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"></path>
                                <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>
                            </svg>
                        </button>
                        <textarea class="biolec-chat__input" rows="1" autocomplete="off" placeholder="Ask about products, delivery, or orders" aria-label="Message"></textarea>
                        <button class="biolec-chat__send" type="submit" aria-label="Send message">
                            <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                                <path d="M4 10h11M11 5l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
                            </svg>
                        </button>
                    </div>
                    <div class="biolec-chat__foot">
                        <span class="biolec-chat__foot-contact">
                            <button type="button" class="biolec-chat__handoff-open">Talk to a team member</button>
                            <?php $biolec_phone = (string) get_option('biolec_codex_bot_support_phone'); ?>
                            <?php if ($biolec_phone !== '') : ?>
                                <a class="biolec-chat__call" href="tel:<?php echo esc_attr(preg_replace('/[^0-9+]/', '', $biolec_phone)); ?>">or call <?php echo esc_html($biolec_phone); ?></a>
                            <?php endif; ?>
                        </span>
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
