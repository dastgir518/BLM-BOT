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
                ],
                'customer_name' => [
                    'type' => 'string',
                    'required' => false,
                    'sanitize_callback' => 'sanitize_text_field'
                ],
                'customer_email' => [
                    'type' => 'string',
                    'required' => false,
                    'sanitize_callback' => 'sanitize_email'
                ],
                'hp_field' => [
                    'type' => 'string',
                    'required' => false,
                    'sanitize_callback' => 'sanitize_text_field'
                ]
            ]
        ]);

        register_rest_route('biolec-codex-bot/v1', '/register', [
            'methods' => 'POST',
            'callback' => [__CLASS__, 'register_customer'],
            'permission_callback' => '__return_true',
            'args' => [
                'session_id' => [
                    'type' => 'string',
                    'required' => true,
                    'sanitize_callback' => 'sanitize_text_field'
                ],
                'customer_name' => [
                    'type' => 'string',
                    'required' => true,
                    'sanitize_callback' => 'sanitize_text_field'
                ],
                'customer_email' => [
                    'type' => 'string',
                    'required' => true,
                    'sanitize_callback' => 'sanitize_email'
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
                ],
                'hp_field' => [
                    'type' => 'string',
                    'required' => false,
                    'sanitize_callback' => 'sanitize_text_field'
                ]
            ]
        ]);

        register_rest_route('biolec-codex-bot/v1', '/handoff', [
            'methods' => 'POST',
            'callback' => [__CLASS__, 'handoff'],
            'permission_callback' => '__return_true',
            'args' => [
                'session_id' => [
                    'type' => 'string',
                    'required' => false,
                    'sanitize_callback' => 'sanitize_text_field'
                ],
                'customer_name' => [
                    'type' => 'string',
                    'required' => true,
                    'sanitize_callback' => 'sanitize_text_field'
                ],
                'customer_email' => [
                    'type' => 'string',
                    'required' => true,
                    'sanitize_callback' => 'sanitize_email'
                ],
                'phone' => [
                    'type' => 'string',
                    'required' => false,
                    'sanitize_callback' => 'sanitize_text_field'
                ],
                'message' => [
                    'type' => 'string',
                    'required' => false,
                    'sanitize_callback' => 'sanitize_textarea_field'
                ],
                'transcript' => [
                    'required' => false
                ],
                'current_url' => [
                    'type' => 'string',
                    'required' => false,
                    'sanitize_callback' => 'esc_url_raw'
                ],
                'hp_field' => [
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
            'status' => ['publish'],
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

    public static function register_customer(WP_REST_Request $request)
    {
        return self::proxy_post('/chat/register', [
            'session_id' => $request->get_param('session_id'),
            'customer_name' => $request->get_param('customer_name'),
            'customer_email' => $request->get_param('customer_email'),
            'current_url' => $request->get_param('current_url'),
            'current_title' => $request->get_param('current_title'),
            'hp_field' => $request->get_param('hp_field')
        ]);
    }

    public static function chat(WP_REST_Request $request)
    {
        return self::proxy_post('/chat', [
            'session_id' => $request->get_param('session_id'),
            'message' => $request->get_param('message'),
            'current_url' => $request->get_param('current_url'),
            'current_title' => $request->get_param('current_title'),
            'customer_name' => $request->get_param('customer_name'),
            'customer_email' => $request->get_param('customer_email'),
            'hp_field' => $request->get_param('hp_field')
        ]);
    }

    private static function client_ip()
    {
        $ip = isset($_SERVER['REMOTE_ADDR']) ? (string) $_SERVER['REMOTE_ADDR'] : '';
        return sanitize_text_field($ip);
    }

    public static function handoff(WP_REST_Request $request)
    {
        // Honeypot: only bots fill this. Pretend success, send nothing.
        if ($request->get_param('hp_field')) {
            return new WP_REST_Response(['ok' => true], 200);
        }

        $name = trim((string) $request->get_param('customer_name'));
        $email = sanitize_email((string) $request->get_param('customer_email'));
        if (!$name || !is_email($email)) {
            return new WP_REST_Response(['error' => 'A valid name and email are required.'], 400);
        }

        // Simple per-IP throttle to protect the support inbox.
        $ip = self::client_ip();
        $throttle_key = 'biolec_handoff_' . md5($ip);
        $count = (int) get_transient($throttle_key);
        if ($count >= 5) {
            return new WP_REST_Response([
                'error' => 'You have sent several requests already. Our team will be in touch shortly.'
            ], 429);
        }
        set_transient($throttle_key, $count + 1, 10 * MINUTE_IN_SECONDS);

        $phone = trim((string) $request->get_param('phone'));
        $message = trim((string) $request->get_param('message'));
        $page_url = (string) $request->get_param('current_url');
        $transcript = $request->get_param('transcript');

        $to = self::support_recipients();
        $subject = 'New chat handoff from ' . $name;
        $body = self::handoff_email_body($name, $email, $phone, $message, $page_url, $transcript);
        $headers = [
            'Content-Type: text/plain; charset=UTF-8',
            'Reply-To: ' . $name . ' <' . $email . '>'
        ];

        $sent = wp_mail($to, $subject, $body, $headers);

        // Best-effort: record the handoff in support_handoffs via the bot server.
        self::proxy_post('/handoff', [
            'session_id' => $request->get_param('session_id'),
            'customer_name' => $name,
            'customer_email' => $email,
            'phone' => $phone,
            'message' => $message,
            'transcript' => is_array($transcript) ? $transcript : []
        ]);

        if (!$sent) {
            return new WP_REST_Response([
                'error' => 'We could not send your request just now. Please call Bio Lec Mobility and we will be glad to help.'
            ], 502);
        }

        return new WP_REST_Response(['ok' => true], 200);
    }

    private static function support_recipients()
    {
        $configured = (string) get_option('biolec_codex_bot_support_email');
        $emails = array_filter(array_map('sanitize_email', array_map('trim', explode(',', $configured))));
        if (empty($emails)) {
            $emails = [get_option('admin_email')];
        }
        return $emails;
    }

    private static function handoff_email_body($name, $email, $phone, $message, $page_url, $transcript)
    {
        $lines = [
            'A customer has asked to speak with the team.',
            '',
            'Name: ' . $name,
            'Email: ' . $email,
            'Phone: ' . ($phone !== '' ? $phone : 'not provided'),
            'Page: ' . ($page_url !== '' ? $page_url : 'unknown'),
            ''
        ];

        if ($message !== '') {
            $lines[] = 'Message:';
            $lines[] = $message;
            $lines[] = '';
        }

        if (is_array($transcript) && !empty($transcript)) {
            $lines[] = 'Conversation:';
            foreach ($transcript as $turn) {
                $role = isset($turn['role']) ? (string) $turn['role'] : '';
                $content = isset($turn['content']) ? wp_strip_all_tags((string) $turn['content']) : '';
                if ($content === '') {
                    continue;
                }
                $who = ($role === 'user') ? 'Customer' : 'Mobi';
                $lines[] = $who . ': ' . $content;
            }
            $lines[] = '';
        }

        $lines[] = 'Reply directly to this email to respond to the customer.';
        return implode("\n", $lines);
    }

    private static function proxy_post($path, array $payload)
    {
        $server_url = rtrim((string) get_option('biolec_codex_bot_server_url'), '/');
        if (!$server_url) {
            return new WP_REST_Response([
                'error' => 'Bot server URL is not configured.'
            ], 500);
        }

        $body = wp_json_encode($payload);
        $secret = (string) get_option('biolec_codex_bot_sync_secret');
        $timestamp = (string) time();

        $headers = [
            'Content-Type' => 'application/json',
            'X-Biolec-Client-IP' => self::client_ip()
        ];

        // Sign the request with the same HMAC scheme used for product sync so the
        // bot server can reject any traffic that did not come through WordPress.
        if ($secret) {
            $headers['X-Biolec-Timestamp'] = $timestamp;
            $headers['X-Biolec-Signature'] = 'sha256=' . hash_hmac('sha256', $timestamp . '.' . $body, $secret);
        }

        $response = wp_remote_post($server_url . $path, [
            'timeout' => 120,
            'headers' => $headers,
            'body' => $body
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
