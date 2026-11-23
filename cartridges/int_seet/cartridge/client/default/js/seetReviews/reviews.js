'use strict';

/**
 * Review pagination. Fetches the server-rendered list fragment from the
 * storefront (Seet-ReviewsList); the Seet API is never called from the browser.
 */

var BUTTON_SELECTOR = '[data-seet-page-url]';
var SECTION_SELECTOR = '[data-seet-reviews]';
var LIST_SELECTOR = '[data-seet-list]';
var initialized = false;

/**
 * @param {Element} section - reviews section
 * @param {Element} list - current list element
 */
function showError(section, list) {
    var message = document.createElement('p');
    message.className = 'seet-reviews__message seet-reviews__message--error';
    message.setAttribute('role', 'alert');
    message.textContent = section.getAttribute('data-seet-error') || '';
    var previous = section.querySelector('.seet-reviews__message--error');
    if (previous) {
        previous.parentNode.removeChild(previous);
    }
    list.parentNode.insertBefore(message, list);
}

/**
 * @param {Element} button - pagination button
 * @returns {Promise|undefined} request promise
 */
function loadPage(button) {
    var section = button.closest(SECTION_SELECTOR);
    var list = section && section.querySelector(LIST_SELECTOR);
    if (!list || typeof window.fetch !== 'function') {
        return undefined;
    }

    list.setAttribute('aria-busy', 'true');
    return window.fetch(button.getAttribute('data-seet-page-url'), {
        credentials: 'same-origin',
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
    }).then(function (response) {
        if (!response.ok) {
            throw new Error('HTTP ' + response.status);
        }
        return response.text();
    }).then(function (html) {
        var container = document.createElement('div');
        container.innerHTML = html;
        var newList = container.querySelector(LIST_SELECTOR);
        if (!newList) {
            throw new Error('Invalid reviews fragment');
        }
        var previousError = section.querySelector('.seet-reviews__message--error');
        if (previousError) {
            previousError.parentNode.removeChild(previousError);
        }
        list.parentNode.replaceChild(newList, list);
        newList.focus();
    }).catch(function () {
        list.removeAttribute('aria-busy');
        showError(section, list);
    });
}

/**
 * @param {Event} event - click event
 */
function onClick(event) {
    var target = event.target;
    var button = target && target.closest ? target.closest(BUTTON_SELECTOR) : null;
    if (button) {
        event.preventDefault();
        loadPage(button);
    }
}

/**
 * Registers a single delegated click handler, so it also works for reviews
 * rendered by remote includes after the script was loaded.
 */
function init() {
    if (initialized) {
        return;
    }
    initialized = true;
    document.addEventListener('click', onClick);
}

module.exports = {
    init: init,
    loadPage: loadPage
};
