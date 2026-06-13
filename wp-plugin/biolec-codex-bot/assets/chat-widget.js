(function () {
  var SESSION_KEY = 'biolec_codex_session_id';
  var SESSION_CREATED_KEY = 'biolec_codex_session_created_at';
  var PROFILE_KEY = 'biolec_codex_profile';
  var SESSION_TTL_MS = 60 * 60 * 1000;
  var A11Y_TEXTSIZE_KEY = 'biolec_a11y_textsize';
  var A11Y_CONTRAST_KEY = 'biolec_a11y_contrast';
  var A11Y_AUTOREAD_KEY = 'biolec_a11y_autoread';

  function getSessionId() {
    var existing = window.localStorage.getItem(SESSION_KEY);
    var createdAt = Number(window.localStorage.getItem(SESSION_CREATED_KEY) || 0);
    if (existing && createdAt && Date.now() - createdAt <= SESSION_TTL_MS) return existing;

    return resetSession();
  }

  function resetSession() {
    var created = 'session_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    window.localStorage.setItem(SESSION_KEY, created);
    window.localStorage.setItem(SESSION_CREATED_KEY, String(Date.now()));
    window.localStorage.removeItem(PROFILE_KEY);
    return created;
  }

  // Start a fresh conversation thread but KEEP the stored profile, so a known
  // customer stays identified across "New chat" (no re-gate, no re-asking).
  function newThread() {
    var created = 'session_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    window.localStorage.setItem(SESSION_KEY, created);
    window.localStorage.setItem(SESSION_CREATED_KEY, String(Date.now()));
    return created;
  }

  function getProfile() {
    var createdAt = Number(window.localStorage.getItem(SESSION_CREATED_KEY) || 0);
    if (!createdAt || Date.now() - createdAt > SESSION_TTL_MS) {
      resetSession();
      return null;
    }

    try {
      return JSON.parse(window.localStorage.getItem(PROFILE_KEY) || 'null');
    } catch (_error) {
      return null;
    }
  }

  function setProfile(profile) {
    window.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  }

  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email || '');
  }

  function sanitizeAssistantHtml(html) {
    var template = document.createElement('template');
    template.innerHTML = html || '';
    var allowedTags = ['DIV', 'P', 'STRONG', 'UL', 'LI', 'A', 'IMG'];
    var allowedClasses = ['biolec-result', 'biolec-result__link', 'biolec-result__img', 'biolec-result__media', 'biolec-result__body'];

    Array.prototype.slice.call(template.content.querySelectorAll('*')).forEach(function (node) {
      if (allowedTags.indexOf(node.tagName) === -1) {
        node.replaceWith(document.createTextNode(node.textContent || ''));
        return;
      }

      Array.prototype.slice.call(node.attributes).forEach(function (attribute) {
        if (node.tagName === 'A' && attribute.name === 'href') {
          if (!/^https?:\/\//i.test(attribute.value) && attribute.value.charAt(0) !== '/') {
            node.removeAttribute('href');
          }
          return;
        }

        // Product image: only allow http(s)/relative src and a plain alt.
        if (node.tagName === 'IMG' && attribute.name === 'src') {
          if (!/^https?:\/\//i.test(attribute.value) && attribute.value.charAt(0) !== '/') {
            node.remove();
          }
          return;
        }
        if (node.tagName === 'IMG' && attribute.name === 'alt') {
          return;
        }

        if (attribute.name === 'class') {
          var classes = attribute.value.split(/\s+/).filter(function (className) {
            return allowedClasses.indexOf(className) !== -1;
          });
          if (classes.length) {
            node.setAttribute('class', classes.join(' '));
          } else {
            node.removeAttribute('class');
          }
          return;
        }

        node.removeAttribute(attribute.name);
      });

      if (node.tagName === 'A') {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener');
      }

      if (node.tagName === 'IMG') {
        node.setAttribute('loading', 'lazy');
        if (!node.getAttribute('alt')) node.setAttribute('alt', '');
      }
    });

    return template.innerHTML;
  }

  function addMessage(container, role, text) {
    var message = document.createElement('div');
    message.className = 'biolec-chat__message biolec-chat__message--' + role;
    if (role === 'bot') {
      renderBotMessage(message, text);
    } else {
      message.textContent = text;
    }
    container.appendChild(message);
    container.scrollTop = container.scrollHeight;
    return message;
  }

  // Bot messages render into a content bubble with a sibling speak button, so
  // updating the text (renderBotMessage again) keeps the read-aloud control.
  function renderBotMessage(message, html, messageId) {
    message.innerHTML = '';
    var bubble = document.createElement('div');
    bubble.className = 'biolec-chat__bubble';
    bubble.innerHTML = sanitizeAssistantHtml(html);
    // Hide any product image that fails to load so it doesn't show a broken icon.
    Array.prototype.slice.call(bubble.querySelectorAll('img')).forEach(function (img) {
      img.addEventListener('error', function () { img.style.display = 'none'; });
    });
    message.appendChild(bubble);

    if (window.speechSynthesis) {
      var speak = document.createElement('button');
      speak.type = 'button';
      speak.className = 'biolec-chat__speak';
      speak.setAttribute('aria-label', 'Read this message aloud');
      speak.textContent = '▶️ Listen';
      message.appendChild(speak);
    }

    // Feedback buttons only on real answers (those the server gave an id for).
    if (messageId !== undefined && messageId !== null && messageId !== '') {
      var fb = document.createElement('div');
      fb.className = 'biolec-chat__feedback';
      fb.setAttribute('data-message-id', String(messageId));
      var up = document.createElement('button');
      up.type = 'button';
      up.className = 'biolec-chat__fb biolec-chat__fb--up';
      up.setAttribute('aria-label', 'This answer was helpful');
      up.textContent = '👍';
      var down = document.createElement('button');
      down.type = 'button';
      down.className = 'biolec-chat__fb biolec-chat__fb--down';
      down.setAttribute('aria-label', 'This answer was not helpful');
      down.textContent = '👎';
      fb.appendChild(up);
      fb.appendChild(down);
      message.appendChild(fb);
    }
  }

  // Tracks which speak button is currently reading, so the same button can
  // toggle stop, and its icon reflects the playing/stopped state.
  var activeSpeakBtn = null;

  function setSpeakBtnState(btn, speaking) {
    if (!btn) return;
    btn.textContent = speaking ? '⏸️ Pause' : '▶️ Listen';
    btn.setAttribute('aria-label', speaking ? 'Pause reading' : 'Read this message aloud');
    btn.classList.toggle('is-speaking', !!speaking);
  }

  function speakText(text, btn) {
    if (!window.speechSynthesis) return;
    var clean = String(text || '').trim();
    if (!clean) return;
    // Stop anything already playing and reset its button.
    window.speechSynthesis.cancel();
    if (activeSpeakBtn && activeSpeakBtn !== btn) setSpeakBtnState(activeSpeakBtn, false);
    var utterance = new SpeechSynthesisUtterance(clean);
    utterance.lang = 'en-GB';
    utterance.onend = utterance.onerror = function () {
      if (activeSpeakBtn === btn) activeSpeakBtn = null;
      setSpeakBtnState(btn, false);
    };
    activeSpeakBtn = btn || null;
    setSpeakBtnState(btn, true);
    window.speechSynthesis.speak(utterance);
  }

  // Click handler for a speak button: play, pause, or resume the SAME message
  // instead of restarting from the beginning.
  function toggleSpeak(btn) {
    if (!btn) return;
    var synth = window.speechSynthesis;
    if (!synth) return;
    var bubble = btn.parentNode.querySelector('.biolec-chat__bubble');
    if (!bubble) return;
    if (activeSpeakBtn === btn) {
      if (synth.paused) { synth.resume(); setSpeakBtnState(btn, true); return; }
      if (synth.speaking) { synth.pause(); setSpeakBtnState(btn, false); return; }
    }
    speakText(bubble.textContent, btn);
  }

  document.addEventListener('DOMContentLoaded', function () {
    var root = document.getElementById('biolec-codex-chat');
    if (!root || !window.BiolecCodexBot || !window.BiolecCodexBot.chatUrl) return;

    var scope = mountIsolatedWidget(root);

    var toggle = scope.querySelector('.biolec-chat__toggle');
    var panel = scope.querySelector('.biolec-chat__panel');
    var close = scope.querySelector('.biolec-chat__close');
    var minimizeBtn = scope.querySelector('.biolec-chat__minimize');
    var start = scope.querySelector('.biolec-chat__start');
    var startName = scope.querySelector('.biolec-chat__start-name');
    var startEmail = scope.querySelector('.biolec-chat__start-email');
    var startError = scope.querySelector('.biolec-chat__start-error');
    var startSubmit = start && start.querySelector('button[type="submit"]');
    var teaser = scope.querySelector('.biolec-chat__teaser');
    var teaserClose = scope.querySelector('.biolec-chat__teaser-close');
    var messages = scope.querySelector('.biolec-chat__messages');
    var form = scope.querySelector('.biolec-chat__form');
    var input = scope.querySelector('.biolec-chat__input');
    var prompts = scope.querySelector('.biolec-chat__prompts');
    var honeypot = scope.querySelector('.biolec-chat__hp');
    var handoffForm = scope.querySelector('.biolec-chat__handoff-form');
    var handoffName = scope.querySelector('.biolec-chat__handoff-name');
    var handoffEmail = scope.querySelector('.biolec-chat__handoff-email');
    var handoffPhone = scope.querySelector('.biolec-chat__handoff-phone');
    var handoffMessage = scope.querySelector('.biolec-chat__handoff-message');
    var handoffError = scope.querySelector('.biolec-chat__handoff-error');
    var handoffCancel = scope.querySelector('.biolec-chat__handoff-cancel');
    var handoffSubmit = handoffForm && handoffForm.querySelector('button[type="submit"]');
    var a11yToggle = scope.querySelector('.biolec-chat__a11y-toggle');
    var a11yPanel = scope.querySelector('.biolec-chat__a11y');
    var contrastCheckbox = scope.querySelector('.biolec-chat__a11y-contrast');
    var autoReadCheckbox = scope.querySelector('.biolec-chat__a11y-autoread');
    var mic = scope.querySelector('.biolec-chat__mic');
    var pendingMessage = null;

    initializeChat();

    // Soft gate: the conversation opens straight to the composer. The name/email
    // form is only revealed when the server asks for it (after the free messages).
    // Pass welcomeHtml to override the greeting; pass '' to show no welcome.
    function initializeChat(welcomeHtml) {
      if (start) start.hidden = true;
      messages.hidden = false;
      form.hidden = false;
      if (prompts) prompts.hidden = false;
      messages.innerHTML = '';
      var welcome = welcomeHtml === undefined ? window.BiolecCodexBot.welcome : welcomeHtml;
      if (welcome) addMessage(messages, 'bot', welcome);
    }

    function showStartForm() {
      if (!start) return;
      start.hidden = false;
      showStartError('');
      if (startName) startName.focus();
    }

    // Register the current session with the server. Returns the response data
    // ({ returning, greeting }); throws on failure.
    async function registerSession(name, email) {
      if (!window.BiolecCodexBot.registerUrl) return {};
      var response = await fetch(window.BiolecCodexBot.registerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: getSessionId(),
          customer_name: name,
          customer_email: email,
          current_url: window.location.href,
          current_title: document.title || '',
          hp_field: honeypot ? honeypot.value : ''
        })
      });
      var data = await response.json().catch(function () { return {}; });
      if (!response.ok) throw new Error(data.error || 'Could not start the chat. Please try again.');
      return data;
    }

    var bodyOverflowPrev = '';
    function isMobileView() {
      return window.matchMedia('(max-width: 640px)').matches;
    }

    function openPanel() {
      panel.hidden = false;
      if (teaser) teaser.hidden = true;
      toggle.setAttribute('aria-expanded', 'true');
      scope.classList.add('biolec-chat--open');
      // Lock the page behind the full-screen chat on mobile.
      if (isMobileView()) {
        bodyOverflowPrev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
      }
      input.focus();
    }

    function closePanel() {
      panel.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
      scope.classList.remove('biolec-chat--open');
      document.body.style.overflow = bodyOverflowPrev || '';
    }

    toggle.addEventListener('click', function () {
      if (panel.hidden) {
        openPanel();
      } else {
        closePanel();
      }
    });

    // Minimise: hide the panel but KEEP the conversation, identity and session
    // so reopening shows exactly where the customer left off.
    if (minimizeBtn) minimizeBtn.addEventListener('click', closePanel);

    // Close: clear everything (conversation, identity and session) so the next
    // time the chat is opened it starts fresh.
    function clearChat() {
      if (window.speechSynthesis) window.speechSynthesis.cancel();
      resetSession();
      pendingMessage = null;
      if (handoffForm) handoffForm.hidden = true;
      if (input) {
        input.value = '';
        resizeInput();
      }
      initializeChat();
    }

    close.addEventListener('click', function () {
      clearChat();
      closePanel();
    });

    if (start) {
      start.addEventListener('submit', async function (event) {
        event.preventDefault();
        var name = (startName && startName.value || '').trim();
        var email = (startEmail && startEmail.value || '').trim().toLowerCase();
        showStartError('');
        if (!name) return showStartError('Please enter your name.');
        if (!isValidEmail(email)) return showStartError('Please enter a valid email address.');

        setStartBusy(true);
        try {
          var data = await registerSession(name, email);
          setProfile({ name: name, email: email });
          start.hidden = true;
          if (startName) startName.value = '';
          if (startEmail) startEmail.value = '';
          input.focus();

          // Greet a recognised returning customer (name-only).
          if (data.greeting) addMessage(messages, 'bot', data.greeting);

          // Resume the message that triggered the gate, without re-echoing it.
          if (pendingMessage) {
            var resume = pendingMessage;
            pendingMessage = null;
            sendMessage(resume, { skipEcho: true });
          }
        } catch (error) {
          showStartError(error.message || 'Could not start the chat. Please try again.');
        } finally {
          setStartBusy(false);
        }
      });
    }

    function showStartError(text) {
      if (!startError) return;
      startError.textContent = text || '';
      startError.hidden = !text;
    }

    function setStartBusy(busy) {
      if (startSubmit) {
        startSubmit.disabled = busy;
        startSubmit.textContent = busy ? 'Starting...' : 'Continue';
      }
    }

    if (teaserClose) {
      teaserClose.addEventListener('click', function () {
        teaser.hidden = true;
      });
    }

    function resizeInput() {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    }

    input.addEventListener('input', resizeInput);
    input.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        form.requestSubmit();
      }
    });

    if (prompts) {
      prompts.addEventListener('click', function (event) {
        var button = event.target.closest('[data-prompt]');
        if (!button) return;
        input.value = button.dataset.prompt || '';
        prompts.hidden = true;
        resizeInput();
        form.requestSubmit();
      });
    }

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var text = input.value.trim();
      if (!text) return;
      input.value = '';
      resizeInput();
      sendMessage(text, { skipEcho: false });
    });

    function addTypingMessage() {
      var message = document.createElement('div');
      message.className = 'biolec-chat__message biolec-chat__message--bot';
      var bubble = document.createElement('div');
      bubble.className = 'biolec-chat__bubble';
      var typing = document.createElement('div');
      typing.className = 'biolec-chat__typing';
      typing.setAttribute('aria-label', 'Mobi is typing');
      typing.innerHTML = '<span></span><span></span><span></span>';
      bubble.appendChild(typing);
      message.appendChild(bubble);
      messages.appendChild(message);
      messages.scrollTop = messages.scrollHeight;
      return message;
    }

    async function sendMessage(text, options) {
      var skipEcho = options && options.skipEcho;
      var profile = getProfile() || {};
      if (prompts) prompts.hidden = true;
      if (!skipEcho) addMessage(messages, 'user', text);
      var pending = addTypingMessage();

      try {
        var response = await fetch(window.BiolecCodexBot.chatUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: getSessionId(),
            message: text,
            current_url: window.location.href,
            current_title: document.title || '',
            customer_name: profile.name || '',
            customer_email: profile.email || '',
            hp_field: honeypot ? honeypot.value : ''
          })
        });

        var data = await response.json().catch(function () { return {}; });
        if (response.status === 429) {
          renderBotMessage(pending, '<p>' + (data.error || 'You are sending messages too quickly. Please wait a moment and try again.') + '</p>');
          return;
        }
        if (!response.ok) throw new Error(data.error || 'Request failed');

        // Soft gate: the server needs the customer's details to continue.
        if (data.require_email) {
          pendingMessage = text;
          renderBotMessage(pending, '<p>To carry on helping you, please pop your name and email in below. It only takes a moment.</p>');
          showStartForm();
          return;
        }

        renderBotMessage(pending, data.answer || '<p>Sorry, I could not answer that just now.</p>', data.message_id);
        maybeAutoSpeak(pending);

        // The server detected the customer may want a person; offer a handoff.
        if (data.offer_handoff) addHandoffCta();
      } catch (error) {
        renderBotMessage(pending, '<p>' + (error.message || 'Sorry, I could not connect to the assistant. Please contact our team for help.') + '</p>');
      }
    }

    // --- Human handoff -------------------------------------------------------

    function openHandoff() {
      if (!handoffForm) return;
      var profile = getProfile() || {};
      if (handoffName && !handoffName.value) handoffName.value = profile.name || '';
      if (handoffEmail && !handoffEmail.value) handoffEmail.value = profile.email || '';
      showHandoffError('');
      handoffForm.hidden = false;
      handoffForm.scrollIntoView({ block: 'nearest' });
      if (handoffName) handoffName.focus();
    }

    function addHandoffCta() {
      var cta = document.createElement('div');
      cta.className = 'biolec-chat__message biolec-chat__message--bot biolec-chat__cta';
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'biolec-chat__handoff-open';
      button.textContent = 'Open a support ticket';
      cta.appendChild(button);
      messages.appendChild(cta);
      messages.scrollTop = messages.scrollHeight;
    }

    function showHandoffError(text) {
      if (!handoffError) return;
      handoffError.textContent = text || '';
      handoffError.hidden = !text;
    }

    function collectTranscript() {
      var nodes = messages.querySelectorAll('.biolec-chat__message');
      var turns = [];
      Array.prototype.slice.call(nodes).forEach(function (node) {
        if (node.classList.contains('biolec-chat__cta')) return;
        var role = node.classList.contains('biolec-chat__message--user') ? 'user' : 'bot';
        var content = (node.textContent || '').trim();
        if (content) turns.push({ role: role, content: content });
      });
      return turns.slice(-40);
    }

    // Delegated: handles the always-visible foot button and any inline CTA.
    scope.addEventListener('click', function (event) {
      if (event.target.closest('.biolec-chat__handoff-open')) {
        event.preventDefault();
        openHandoff();
      }
    });

    if (handoffCancel) {
      handoffCancel.addEventListener('click', function () {
        handoffForm.hidden = true;
        showHandoffError('');
      });
    }

    if (handoffForm) {
      handoffForm.addEventListener('submit', async function (event) {
        event.preventDefault();
        var name = (handoffName && handoffName.value || '').trim();
        var email = (handoffEmail && handoffEmail.value || '').trim().toLowerCase();
        showHandoffError('');
        if (!name) return showHandoffError('Please enter your name.');
        if (!isValidEmail(email)) return showHandoffError('Please enter a valid email address.');
        if (!window.BiolecCodexBot.handoffUrl) return showHandoffError('Sorry, this is unavailable right now.');

        setHandoffBusy(true);
        try {
          var response = await fetch(window.BiolecCodexBot.handoffUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              session_id: getSessionId(),
              customer_name: name,
              customer_email: email,
              phone: (handoffPhone && handoffPhone.value || '').trim(),
              message: (handoffMessage && handoffMessage.value || '').trim(),
              transcript: collectTranscript(),
              current_url: window.location.href,
              hp_field: honeypot ? honeypot.value : ''
            })
          });
          var data = await response.json().catch(function () { return {}; });
          if (!response.ok) throw new Error(data.error || 'Could not send your request. Please try again.');

          handoffForm.hidden = true;
          if (handoffMessage) handoffMessage.value = '';
          addMessage(messages, 'bot', '<p>Thanks ' + escapeText(name) + ', our team has your details and will get back to you at ' + escapeText(email) + ' shortly.</p>');
        } catch (error) {
          showHandoffError(error.message || 'Could not send your request. Please try again.');
        } finally {
          setHandoffBusy(false);
        }
      });
    }

    function setHandoffBusy(busy) {
      if (handoffSubmit) {
        handoffSubmit.disabled = busy;
        handoffSubmit.textContent = busy ? 'Sending...' : 'Send to team';
      }
    }

    // --- Accessibility: read-aloud, voice input, text size, contrast ---------

    function autoReadEnabled() {
      return window.localStorage.getItem(A11Y_AUTOREAD_KEY) === '1';
    }

    function maybeAutoSpeak(messageEl) {
      if (!autoReadEnabled()) return;
      var bubble = messageEl.querySelector('.biolec-chat__bubble');
      var btn = messageEl.querySelector('.biolec-chat__speak');
      if (bubble) speakText(bubble.textContent, btn);
    }

    // Delegated: read-aloud buttons on bot messages.
    scope.addEventListener('click', function (event) {
      var speakBtn = event.target.closest('.biolec-chat__speak');
      if (!speakBtn) return;
      toggleSpeak(speakBtn);
    });

    // Delegated: thumbs up/down feedback on bot answers.
    scope.addEventListener('click', function (event) {
      var fbBtn = event.target.closest('.biolec-chat__fb');
      if (!fbBtn) return;
      var wrap = fbBtn.closest('.biolec-chat__feedback');
      if (!wrap || wrap.getAttribute('data-done') === '1') return;
      var messageId = wrap.getAttribute('data-message-id');
      var rating = fbBtn.classList.contains('biolec-chat__fb--up') ? 'up' : 'down';
      sendFeedback(messageId, rating);
      wrap.setAttribute('data-done', '1');
      fbBtn.classList.add('is-selected');
      var thanks = document.createElement('span');
      thanks.className = 'biolec-chat__fb-thanks';
      thanks.textContent = 'Thanks for the feedback';
      wrap.appendChild(thanks);
    });

    function sendFeedback(messageId, rating) {
      if (!window.BiolecCodexBot.feedbackUrl || !messageId) return;
      // Fire-and-forget; feedback should never interrupt the chat.
      fetch(window.BiolecCodexBot.feedbackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: getSessionId(), message_id: messageId, rating: rating })
      }).catch(function () {});
    }

    function applyAccessibilitySettings() {
      var size = window.localStorage.getItem(A11Y_TEXTSIZE_KEY) || 'larger';
      scope.classList.remove('biolec-a11y-text-large', 'biolec-a11y-text-larger');
      if (size === 'large') scope.classList.add('biolec-a11y-text-large');
      if (size === 'larger') scope.classList.add('biolec-a11y-text-larger');

      var contrast = window.localStorage.getItem(A11Y_CONTRAST_KEY) === '1';
      scope.classList.toggle('biolec-a11y-contrast', contrast);
      if (contrastCheckbox) contrastCheckbox.checked = contrast;
      if (autoReadCheckbox) autoReadCheckbox.checked = autoReadEnabled();

      var sizeButtons = a11yPanel ? a11yPanel.querySelectorAll('[data-textsize]') : [];
      Array.prototype.slice.call(sizeButtons).forEach(function (button) {
        button.classList.toggle('is-active', button.dataset.textsize === size);
      });
    }

    if (a11yToggle && a11yPanel) {
      a11yToggle.addEventListener('click', function () {
        a11yPanel.hidden = !a11yPanel.hidden;
        a11yToggle.setAttribute('aria-expanded', String(!a11yPanel.hidden));
      });
    }

    if (a11yPanel) {
      a11yPanel.addEventListener('click', function (event) {
        var button = event.target.closest('[data-textsize]');
        if (!button) return;
        window.localStorage.setItem(A11Y_TEXTSIZE_KEY, button.dataset.textsize);
        applyAccessibilitySettings();
      });
    }

    if (contrastCheckbox) {
      contrastCheckbox.addEventListener('change', function () {
        window.localStorage.setItem(A11Y_CONTRAST_KEY, contrastCheckbox.checked ? '1' : '');
        applyAccessibilitySettings();
      });
    }

    if (autoReadCheckbox) {
      autoReadCheckbox.addEventListener('change', function () {
        window.localStorage.setItem(A11Y_AUTOREAD_KEY, autoReadCheckbox.checked ? '1' : '');
        if (!autoReadCheckbox.checked && window.speechSynthesis) window.speechSynthesis.cancel();
      });
    }

    applyAccessibilitySettings();

    // Voice input via the Web Speech API, only where supported.
    var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (mic && SpeechRecognition) {
      mic.hidden = false;
      var recognition = new SpeechRecognition();
      recognition.lang = 'en-GB';
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      var listening = false;

      mic.addEventListener('click', function () {
        if (listening) {
          recognition.stop();
          return;
        }
        try {
          recognition.start();
        } catch (_error) {
          // start() throws if already started; ignore.
        }
      });

      recognition.addEventListener('start', function () {
        listening = true;
        mic.classList.add('is-listening');
      });

      recognition.addEventListener('result', function (event) {
        var transcript = '';
        for (var i = 0; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
        transcript = transcript.trim();
        if (transcript) {
          input.value = (input.value ? input.value + ' ' : '') + transcript;
          resizeInput();
          input.focus();
        }
      });

      var stopListening = function () {
        listening = false;
        mic.classList.remove('is-listening');
      };
      recognition.addEventListener('end', stopListening);
      recognition.addEventListener('error', stopListening);
    }
  });

  function escapeText(value) {
    var div = document.createElement('div');
    div.textContent = String(value || '');
    return div.innerHTML;
  }

  function mountIsolatedWidget(root) {
    if (!root.attachShadow || root.shadowRoot) {
      return root;
    }

    var shadow = root.attachShadow({ mode: 'open' });
    var wrapper = document.createElement('div');
    wrapper.className = 'biolec-chat';

    if (window.BiolecCodexBot.styleUrl) {
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = window.BiolecCodexBot.styleUrl;
      shadow.appendChild(link);
    }

    while (root.firstChild) {
      wrapper.appendChild(root.firstChild);
    }

    root.className = '';
    shadow.appendChild(wrapper);
    return wrapper;
  }
})();
