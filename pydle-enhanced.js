// ==UserScript==
// @name         Pydle Enhanced
// @namespace    http://tampermonkey.net/
// @version      1.25
// @description  A Tampermonkey userscript for Pydle.net that adds more features
// @author       Swakshan
// @match        https://pydle.net/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=pydle.net
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    // -------------------------------------------------------------
    // 1. GLOBAL DATE OVERRIDE (Runs before page scripts execute)
    // -------------------------------------------------------------
    (function overrideGlobalDate() {
        const urlParams = new URLSearchParams(window.location.search);
        const idParam = urlParams.get('id');
        const id = parseInt(idParam, 10);

        if (!isNaN(id) && id > 0) {
            const OriginalDate = window.Date;

            // Calculate target date: ID 1 = Feb 24, 2026
            const baseDate = new OriginalDate(2026, 1, 24); // Month 1 = February
            baseDate.setDate(baseDate.getDate() + (id - 1));

            const overriddenTime = baseDate.getTime();

            // Create a custom Date class wrapping OriginalDate
            function MockDate(...args) {
                if (!(this instanceof MockDate)) {
                    // Called as function: Date() -> returns date string
                    return new OriginalDate(overriddenTime).toString();
                }

                if (args.length === 0) {
                    // new Date() called with no args -> return offset date
                    return new OriginalDate(overriddenTime);
                }

                // new Date(...) called with arguments -> standard behavior
                return new (Function.prototype.bind.apply(OriginalDate, [null, ...args]))();
            }

            // Inherit prototype methods (getTime, getFullYear, etc.)
            MockDate.prototype = OriginalDate.prototype;

            // Retain static methods (Date.now(), Date.parse(), Date.UTC())
            MockDate.now = function () {
                return overriddenTime;
            };
            MockDate.parse = OriginalDate.parse;
            MockDate.UTC = OriginalDate.UTC;

            // Apply global override
            window.Date = MockDate;
            console.log(`[Tampermonkey] Date overridden to: ${baseDate.toISOString().split('T')[0]} (ID: ${id})`);
        }
    })();

    // -------------------------------------------------------------
    // 2. DOM & UI LOGIC (Runs after page DOM renders)
    // -------------------------------------------------------------
    const CHAR_BTN_ID = 'pydle-char-counter';
    const ATTEMPT_BTN_ID = 'pydle-attempt-counter';
    const PUZZLE_TITLE_SELECTOR = 'div.group.flex.mr-2.items-center';
    let FIRST_TIME = true;
    const MAX_CHARS = 250;
    // ID 1 = Feb 24, 2026
    const BASE_DATE = "2026-02-24";

    let scrollerObserver = null;
    let isRunListenerAttached = false;
    let lastestPuzzleId = -1;

    function getPuzzleId() {
        const element = document.querySelector(PUZZLE_TITLE_SELECTOR);
        if (!element) return 0;
        const text = element.textContent;
        // Uses regex to find '#' followed by one or more digits
        const match = text.match(/#(\d+)/);

        if (match && match[1]) {
            let content = match[1];
            if (content.includes("#")) return 0;
            return parseInt(content);
        }
        return 0;
    }

    function getLocalStorageData() {
        let key = ""
        try {
            let puzzleId = getPuzzleId();
            let targetDate = new Date();
            if (FIRST_TIME || puzzleId < 1) {
                FIRST_TIME = false;
            } else {
                targetDate = new Date(BASE_DATE);
                targetDate.setDate(targetDate.getDate() + puzzleId - 1)
            }
            const year = targetDate.getFullYear();
            const month = String(targetDate.getMonth() + 1).padStart(2, '0');
            const day = String(targetDate.getDate()).padStart(2, '0');
            key = `pydle:guesses-1:${year}-${month}-${day}`;
            let storedData = localStorage.getItem(key);
            if (!storedData) {
                storedData = "{}"
            }
            return JSON.parse(storedData);
        } catch (error) {
            console.error('Error parsing localStorage key:', key, error);
        }
        return JSON.parse("{}");
    }

    function calculateCharCount() {
        const scroller = document.querySelector(".cm-scroller");
        if (!scroller) return 0;

        const targetNode = scroller.childNodes[1];
        if (!targetNode || !targetNode.textContent) return 0;

        return targetNode.textContent.replace(/\s+/g, '').length;
    }

    function updateCharCountAndRunState() {
        const charBtn = document.getElementById(CHAR_BTN_ID);
        const runContainer = document.querySelector('.flex.mb-1');
        const runBtn = runContainer ? runContainer.querySelector('button') : null;

        const count = calculateCharCount();

        if (charBtn) {
            charBtn.textContent = `Char count: ${count}`;

            if (count > MAX_CHARS) {
                charBtn.style.color = '#ef4444'; // Red color
            } else {
                charBtn.style.color = ''; // Default theme color
            }
        }

        if (runBtn) {
            if (count > MAX_CHARS) {
                runBtn.disabled = true;
                runBtn.style.opacity = '0.5';
                runBtn.style.pointerEvents = 'none';
            } else {
                runBtn.disabled = false;
                runBtn.style.opacity = '1';
                runBtn.style.pointerEvents = 'auto';
            }
        }
    }

    function updateAttempts() {
        const parsedData = getLocalStorageData();
        let count = 0
        if (typeof parsedData.attempts === 'number') {
            count = parsedData.attempts;
        }
        const attemptBtn = document.getElementById(ATTEMPT_BTN_ID);
        if (attemptBtn) {
            attemptBtn.textContent = `Attempts: ${count++}`;
        }
    }

    function onRunButtonClicked(e) {
        const count = calculateCharCount();
        if (count > MAX_CHARS) {
            e.preventDefault();
            return;
        }
        updateAttempts();
    }

    function attachRunButtonListener() {
        if (isRunListenerAttached) return;

        const runContainer = document.querySelector('.flex.mb-1');
        const runBtn = runContainer ? runContainer.querySelector('button') : null;

        if (runBtn) {
            runBtn.addEventListener('click', onRunButtonClicked);
            isRunListenerAttached = true;
        }
    }

    function detachRunButtonListener() {
        if (!isRunListenerAttached) return;

        const runContainer = document.querySelector('.flex.mb-1');
        const runBtn = runContainer ? runContainer.querySelector('button') : null;

        if (runBtn) {
            runBtn.removeEventListener('click', onRunButtonClicked);
        }
        isRunListenerAttached = false;
    }

    function attachScrollerObserver() {
        const scroller = document.querySelector(".cm-scroller");
        if (!scroller) return;

        if (scrollerObserver) {
            scrollerObserver.disconnect();
        }

        updateCharCountAndRunState();

        scrollerObserver = new MutationObserver(() => {
            updateCharCountAndRunState();
        });

        scrollerObserver.observe(scroller, {
            childList: true,
            subtree: true,
            characterData: true
        });
    }

    function detachScrollerObserver() {
        if (scrollerObserver) {
            scrollerObserver.disconnect();
            scrollerObserver = null;
        }
    }

    function handleAriaStateChange(isFirstTabSelected) {
        if (isFirstTabSelected) {
            attachScrollerObserver();
            attachRunButtonListener();
        } else {
            detachScrollerObserver();
            detachRunButtonListener();
        }
    }

    function setupAriaSelectedObserver(firstChild) {
        if (firstChild.dataset.hasAriaObserver) return;
        firstChild.dataset.hasAriaObserver = 'true';

        const isSelected = firstChild.getAttribute('aria-selected') === 'true';
        handleAriaStateChange(isSelected);

        const observer = new MutationObserver(() => {
            const selected = firstChild.getAttribute('aria-selected') === 'true';
            handleAriaStateChange(selected);
        });

        observer.observe(firstChild, {
            attributes: true,
            attributeFilter: ['aria-selected']
        });
    }

    function setupPuzzleChangeObserver() {
        const observer = new MutationObserver(() => {
            const element = document.querySelector(PUZZLE_TITLE_SELECTOR);
            if (element) {
                let currentPuzzleId = getPuzzleId();
                if (lastestPuzzleId != currentPuzzleId) {
                    updateAttempts();
                    lastestPuzzleId = currentPuzzleId;
                }
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true
        });
    }

    function createStatsButtons(container) {
        if (document.getElementById(CHAR_BTN_ID)) return;

        const templateBtn = container.lastElementChild;
        if (!templateBtn) return;

        let characters = 0;
        let attempts = 0;

        const parsedData = getLocalStorageData();

        if (typeof parsedData.characters === 'number') characters = parsedData.characters;
        if (typeof parsedData.attempts === 'number') attempts = parsedData.attempts;

        function appendButton(id, text) {
            const newBtn = templateBtn.cloneNode(true);
            newBtn.id = id;
            newBtn.textContent = text;

            newBtn.removeAttribute('role');
            newBtn.removeAttribute('aria-selected');
            newBtn.removeAttribute('aria-controls');
            newBtn.removeAttribute('data-selected')
            newBtn.style.cursor = 'default';
            newBtn.style.userSelect = 'none';

            container.appendChild(newBtn);
        }

        appendButton(CHAR_BTN_ID, `Char count: ${characters}`);
        appendButton(ATTEMPT_BTN_ID, `Attempts: ${attempts}`);
    }

    function initUI() {
        const container = document.querySelector('.flex.gap-4');
        if (!container) return false;

        const firstChild = container.firstElementChild;
        if (!firstChild) return false;

        createStatsButtons(container);
        setupAriaSelectedObserver(firstChild);
        setupPuzzleChangeObserver();

        return true;
    }

    // Attach UI listener on DOM loading
    window.addEventListener('DOMContentLoaded', function () {
        if (!initUI()) {
            const pageObserver = new MutationObserver((mutations, obs) => {
                if (initUI()) {
                    obs.disconnect();
                }
            });
            pageObserver.observe(document.body, {
                childList: true,
                subtree: true
            });
        }
    });
})();