// ==UserScript==
// @name         Pydle Enhanced
// @namespace    http://tampermonkey.net/
// @version      1.35
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
        const idParam = urlParams.get('game');
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
    const SHARE_STATS_BTN_ID = 'pydle-share-stats';

    const PUZZLE_TITLE_SELECTOR = 'div.group.flex.mr-2.items-center';
    let FIRST_TIME = true;
    const MAX_CHARS = 250;
    // ID 1 = Feb 24, 2026
    const BASE_DATE = "2026-02-24";

    let scrollerObserver = null;
    let isRunListenerAttached = false;
    let lastestPuzzleId = -1;

    // Emoji Mapping Dictionary
    const colorEmojiMap = {
        red: '🟥',
        orange: '🟧',
        yellow: '🟨',
        green: '🟩',
        blue: '🟦',
        purple: '🟪',
        brown: '🟫',
        black: '⬛',
        white: '⬜'
    };

    // Color CSS Mapping for HTML modal display
    const colorCssMap = {
        red: '#d90429',
        orange: '#f77f00',
        yellow: '#fcbf49',
        green: '#2d6a4f',
        blue: '#0077b6',
        purple: '#7b2cbf',
        brown: '#6c584c',
        black: '#1f1f1f',
        white: '#ffffff'
    };

    function showShareDialog(data) {
        // Remove existing modal if already open
        const existing = document.getElementById('pydle-custom-modal');
        if (existing) existing.remove();

        const output = data.output;
        const game = data.game;
        const attempts = data.attempts;
        const characters = data.characters;
        const gridRows = output.length;
        const gridCols = output[0] ? output[0].length : 5;

        // 1. Convert output matrix into HTML elements for visual preview
        const gridHtml = output.flatMap(row => 
            row.map(cell => {
                const color = cell[1] || 'black';
                const cssColor = colorCssMap[color] || '#333333';
                return `<div style="
                    aspect-ratio: 1; 
                    width: 100%; 
                    max-width: 32px; 
                    background: ${cssColor}; 
                    border-radius: 6px;
                "></div>`;
            })
        ).join('');

        // 2. Convert output matrix into Emoji string (t)
        const t = output.map(row => {
            return row.map(cell => {
                const color = cell[1];
                return colorEmojiMap[color] || '⬛';
            }).join('');
        }).join('\n');

        // 3. Format output string using your exact template string
        let shareText = `Pydle #${game}\n${t}\nAttempts: ${attempts}\nCharacters: ${characters}/250\n`;

       // Create modal overlay
        const overlay = document.createElement('div');
        overlay.id = 'pydle-custom-modal';
        overlay.style.cssText = `
            position: fixed;
            top: 0; left: 0; width: 100vw; height: 100vh;
            background-color: rgba(0, 0, 0, 0.75);
            backdrop-filter: blur(4px);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 1000000;
            padding: 2vw;
            box-sizing: border-box;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        `;

        // Responsive Modal Container
        overlay.innerHTML = `
            <div style="
                background-color: #0c0c0c;
                color: #ffffff;
                padding: clamp(16px, 4vw, 32px);
                border-radius: min(4vw, 16px);
                width: min(90vw, 420px);
                max-height: 90vh;
                overflow-y: auto;
                box-shadow: 0 12px 32px rgba(0,0,0,0.7);
                position: relative;
                border: 1px solid #1f1f1f;
                box-sizing: border-box;
                display: flex;
                flex-direction: column;
            ">
                <!-- Close Button -->
                <button id="pydle-close-btn" style="
                    position: absolute;
                    top: clamp(12px, 3vw, 20px);
                    right: clamp(12px, 3vw, 20px);
                    background: #1f1f1f;
                    border: none;
                    color: #fff;
                    font-size: clamp(12px, 2vw, 14px);
                    cursor: pointer;
                    width: clamp(26px, 5vw, 32px);
                    height: clamp(26px, 5vw, 32px);
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                ">✕</button>

                <!-- Header -->
                <h2 style="
                    margin: 0 0 clamp(12px, 3vw, 24px) 0; 
                    font-size: clamp(16px, 3.5vw, 20px); 
                    font-weight: 600;
                ">You completed the Pydle!</h2>

                <!-- Subheader -->
                <div style="
                    font-size: clamp(12px, 2.5vw, 14px); 
                    margin-bottom: clamp(10px, 2vw, 16px); 
                    font-weight: 500;
                ">Pydle #${game}</div>

                <!-- Responsive CSS Grid Output -->
                <div style="
                    display: grid;
                    grid-template-columns: repeat(${gridCols}, minmax(0, 32px));
                    gap: clamp(4px, 1vw, 6px);
                    margin-bottom: clamp(16px, 3vw, 24px);
                    justify-content: start;
                ">
                    ${gridHtml}
                </div>

                <!-- Stats Text -->
                <div style="font-size: clamp(12px, 2.5vw, 14px); color: #e5e7eb; margin-bottom: 6px;">Attempts: ${attempts}</div>
                <div style="font-size: clamp(12px, 2.5vw, 14px); color: #e5e7eb; margin-bottom: clamp(16px, 3vw, 24px);">Characters: ${characters}/250</div>

                <!-- Action Buttons -->
                <div style="display: flex; gap: clamp(8px, 2vw, 12px); margin-top: auto;">
                    <button id="pydle-share-btn" style="
                        flex: 1;
                        background-color: #1f2937;
                        color: #ffffff;
                        border: 1px solid #374151;
                        padding: clamp(8px, 1.8vw, 12px) clamp(12px, 2vw, 16px);
                        border-radius: 8px;
                        font-weight: 600;
                        font-size: clamp(12px, 2.5vw, 14px);
                        cursor: pointer;
                    ">Share</button>
                    <button id="pydle-copy-btn" style="
                        flex: 1;
                        background-color: #1f2937;
                        color: #ffffff;
                        border: 1px solid #374151;
                        padding: clamp(8px, 1.8vw, 12px) clamp(12px, 2vw, 16px);
                        border-radius: 8px;
                        font-weight: 600;
                        font-size: clamp(12px, 2.5vw, 14px);
                        cursor: pointer;
                    ">Copy</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        // Event Listeners
        document.getElementById('pydle-close-btn').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });

        // Copy Handler
        const handleCopy = async () => {
            try {
                shareText+="https://pydle.net/";
                await navigator.clipboard.writeText(shareText);
                overlay.remove();
            } catch (err) {
                console.error("Failed to copy: ", err);
            }
        };

        document.getElementById('pydle-copy-btn').addEventListener('click', handleCopy);
        // Share Handler
        document.getElementById('pydle-share-btn').addEventListener('click', async () => {
            if (navigator.share) {
                try {
                    await navigator.share({
                        title: `Pydle #${game}`,
                        text: shareText
                    });
                } catch (err) {
                    handleCopy();
                }
            } else {
                handleCopy();
            }
        });
    }

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

    function getCurrentPuzzleLocalStorageData() {
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

    function handleShareButton(){
        const puzzleData = getCurrentPuzzleLocalStorageData();
        let isSolved = puzzleData.solved;
        let isSuccess = puzzleData.success;

        let shareBtn = document.getElementById(SHARE_STATS_BTN_ID);
        if (isSuccess && isSolved){
            shareBtn.style.display = '';
        }
        else{
            shareBtn.style.display = 'none';
        }

        shareBtn.addEventListener('click', () => {
            showShareDialog(puzzleData);
        });

    }

    function updateAttempts() {
        const parsedData = getCurrentPuzzleLocalStorageData();
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
                    handleShareButton();
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

        const parsedData = getCurrentPuzzleLocalStorageData();

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
        appendButton(SHARE_STATS_BTN_ID, `Share`);
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