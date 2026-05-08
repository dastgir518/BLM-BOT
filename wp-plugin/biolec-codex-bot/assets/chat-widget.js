(function () {
  function getSessionId() {
    var key = 'biolec_codex_session_id';
    var existing = window.localStorage.getItem(key);
    if (existing) return existing;

    var created = 'session_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    window.localStorage.setItem(key, created);
    return created;
  }

  function sanitizeAssistantHtml(html) {
    var template = document.createElement('template');
    template.innerHTML = html || '';
    var allowedTags = ['DIV', 'P', 'STRONG', 'UL', 'LI', 'A'];
    var allowedClasses = ['biolec-result', 'biolec-result__link'];

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
    });

    return template.innerHTML;
  }

  function addMessage(container, role, text) {
    var message = document.createElement('div');
    message.className = 'biolec-chat__message biolec-chat__message--' + role;
    if (role === 'bot') {
      message.innerHTML = sanitizeAssistantHtml(text);
    } else {
      message.textContent = text;
    }
    container.appendChild(message);
    container.scrollTop = container.scrollHeight;
    return message;
  }

  document.addEventListener('DOMContentLoaded', function () {
    var root = document.getElementById('biolec-codex-chat');
    if (!root || !window.BiolecCodexBot || !window.BiolecCodexBot.chatUrl) return;

    var scope = mountIsolatedWidget(root);

    var toggle = scope.querySelector('.biolec-chat__toggle');
    var panel = scope.querySelector('.biolec-chat__panel');
    var close = scope.querySelector('.biolec-chat__close');
    var teaser = scope.querySelector('.biolec-chat__teaser');
    var teaserClose = scope.querySelector('.biolec-chat__teaser-close');
    var messages = scope.querySelector('.biolec-chat__messages');
    var form = scope.querySelector('.biolec-chat__form');
    var input = scope.querySelector('.biolec-chat__input');
    var quick = scope.querySelector('.biolec-chat__quick');
    var prompts = scope.querySelector('.biolec-chat__prompts');

    addMessage(messages, 'bot', window.BiolecCodexBot.welcome);

    function openPanel() {
      panel.hidden = false;
      if (teaser) teaser.hidden = true;
      toggle.setAttribute('aria-expanded', 'true');
      input.focus();
    }

    function closePanel() {
      panel.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
    }

    toggle.addEventListener('click', function () {
      if (panel.hidden) {
        openPanel();
      } else {
        closePanel();
      }
    });

    close.addEventListener('click', closePanel);

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

    if (quick) {
      quick.addEventListener('click', function (event) {
        var button = event.target.closest('[data-prompt]');
        if (!button) return;
        input.value = button.dataset.prompt || '';
        resizeInput();
        form.requestSubmit();
      });
    }

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

    form.addEventListener('submit', async function (event) {
      event.preventDefault();

      var text = input.value.trim();
      if (!text) return;

      input.value = '';
      resizeInput();
      if (prompts) prompts.hidden = true;
      addMessage(messages, 'user', text);
      var pending = addMessage(messages, 'bot', '<p>One moment...</p>');

      try {
        var response = await fetch(window.BiolecCodexBot.chatUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: getSessionId(),
            message: text,
            current_url: window.location.href,
            current_title: document.title || ''
          })
        });

        var data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Request failed');
        pending.innerHTML = sanitizeAssistantHtml(data.answer || '<p>Sorry, I could not answer that just now.</p>');
      } catch (error) {
        pending.innerHTML = sanitizeAssistantHtml('<p>' + (error.message || 'Sorry, I could not connect to the assistant. Please contact our team for help.') + '</p>');
      }
    });
  });

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
