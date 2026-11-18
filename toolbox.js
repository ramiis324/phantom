/* Phantom game toolbox — shared by player.html and flash.html.
   Builds a fullscreen frosted-glass overlay with two tabs (Quick Settings and
   Display) and wires optional controls-bar buttons (screenshot / FPS / pause).
   It reads window.PHANTOM (set by each page) for context. */
(function () {
  "use strict";

  var P = window.PHANTOM || {};
  /* The page publishes window.PHANTOM only after it has looked the game up
     (an async fetch), which is later than this script runs. Read it lazily:
     a snapshot taken at load has an empty cleanName, so bookmarks were saved
     under "" and never matched a game on the home page. */
  function page() { return window.PHANTOM || P; }
  var CFG = {
    get cleanName() { return page().cleanName || ""; },
    get title() { return page().title || ""; },
    get genre() { return page().genre || ""; },
    get stats() { return page().stats || null; },
    get gameFrame() { return page().gameFrame || function () { return null; }; },
    get container() { return page().auroraContainer || null; }
  };

  function store(key, def) {
    try {
      var v = localStorage.getItem(key);
      return v === null ? def : v;
    } catch (e) { return def; }
  }
  function setStore(key, val) {
    try { localStorage.setItem(key, String(val)); } catch (e) {}
  }

  /* ---------------- icons ---------------- */
  var ICON = {
    gear: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" color="currentColor" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21.3175 7.14139L20.8239 6.28479C20.4506 5.63696 20.264 5.31305 19.9464 5.18388C19.6288 5.05472 19.2696 5.15664 18.5513 5.36048L17.3311 5.70418C16.8725 5.80994 16.3913 5.74994 15.9726 5.53479L15.6357 5.34042C15.2766 5.11043 15.0004 4.77133 14.8475 4.37274L14.5136 3.37536C14.294 2.71534 14.1842 2.38533 13.9228 2.19657C13.6615 2.00781 13.3143 2.00781 12.6199 2.00781H11.5051C10.8108 2.00781 10.4636 2.00781 10.2022 2.19657C9.94085 2.38533 9.83106 2.71534 9.61149 3.37536L9.27753 4.37274C9.12465 4.77133 8.84845 5.11043 8.48937 5.34042L8.15249 5.53479C7.73374 5.74994 7.25259 5.80994 6.79398 5.70418L5.57375 5.36048C4.85541 5.15664 4.49625 5.05472 4.17867 5.18388C3.86109 5.31305 3.67445 5.63696 3.30115 6.28479L2.80757 7.14139C2.45766 7.74864 2.2827 8.05227 2.31666 8.37549C2.35061 8.69871 2.58483 8.95918 3.05326 9.48012L4.0843 10.6328C4.3363 10.9518 4.51521 11.5078 4.51521 12.0077C4.51521 12.5078 4.33636 13.0636 4.08433 13.3827L3.05326 14.5354C2.58483 15.0564 2.35062 15.3168 2.31666 15.6401C2.2827 15.9633 2.45766 16.2669 2.80757 16.8741L3.30114 17.7307C3.67443 18.3785 3.86109 18.7025 4.17867 18.8316C4.49625 18.9608 4.85542 18.8589 5.57377 18.655L6.79394 18.3113C7.25263 18.2055 7.73387 18.2656 8.15267 18.4808L8.4895 18.6752C8.84851 18.9052 9.12464 19.2442 9.2775 19.6428L9.61149 20.6403C9.83106 21.3003 9.94085 21.6303 10.2022 21.8191C10.4636 22.0078 10.8108 22.0078 11.5051 22.0078H12.6199C13.3143 22.0078 13.6615 22.0078 13.9228 21.8191C14.1842 21.6303 14.294 21.3003 14.5136 20.6403L14.8476 19.6428C15.0004 19.2442 15.2765 18.9052 15.6356 18.6752L15.9724 18.4808C16.3912 18.2656 16.8724 18.2055 17.3311 18.3113L18.5513 18.655C19.2696 18.8589 19.6288 18.9608 19.9464 18.8316C20.264 18.7025 20.4506 18.3785 20.8239 17.7307L21.3175 16.8741C21.6674 16.2669 21.8423 15.9633 21.8084 15.6401C21.7744 15.3168 21.5402 15.0564 21.0718 14.5354L20.0407 13.3827C19.7887 13.0636 19.6098 12.5078 19.6098 12.0077C19.6098 11.5078 19.7888 10.9518 20.0407 10.6328L21.0718 9.48012C21.5402 8.95918 21.7744 8.69871 21.8084 8.37549C21.8423 8.05227 21.6674 7.74864 21.3175 7.14139Z" stroke-linecap="round"></path><path d="M15.5195 12C15.5195 13.933 13.9525 15.5 12.0195 15.5C10.0865 15.5 8.51953 13.933 8.51953 12C8.51953 10.067 10.0865 8.5 12.0195 8.5C13.9525 8.5 15.5195 10.067 15.5195 12Z"></path></svg>',
    display: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" color="currentColor" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 21H16M14 21C13.1716 21 12.5 20.3284 12.5 19.5V17L12 17M14 21H10M10 21H8M10 21C10.8284 21 11.5 20.3284 11.5 19.5V17L12 17M12 17V21"></path><path d="M16 3H8C5.17157 3 3.75736 3 2.87868 3.87868C2 4.75736 2 6.17157 2 9V11C2 13.8284 2 15.2426 2.87868 16.1213C3.75736 17 5.17157 17 8 17H16C18.8284 17 20.2426 17 21.1213 16.1213C22 15.2426 22 13.8284 22 11V9C22 6.17157 22 4.75736 21.1213 3.87868C20.2426 3 18.8284 3 16 3Z"></path></svg>',
    bookmark: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" color="currentColor" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 17.9808V9.70753C4 6.07416 4 4.25748 5.17157 3.12874C6.34315 2 8.22876 2 12 2C15.7712 2 17.6569 2 18.8284 3.12874C20 4.25748 20 6.07416 20 9.70753V17.9808C20 20.2867 20 21.4396 19.2272 21.8523C17.7305 22.6514 14.9232 19.9852 13.59 19.1824C12.8168 18.7168 12.4302 18.484 12 18.484C11.5698 18.484 11.1832 18.7168 10.41 19.1824C9.0768 19.9852 6.26947 22.6514 4.77285 21.8523C4 21.4396 4 20.2867 4 17.9808Z"></path></svg>',
    pause: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" color="currentColor" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 7C4 5.58579 4 4.87868 4.43934 4.43934C4.87868 4 5.58579 4 7 4C8.41421 4 9.12132 4 9.56066 4.43934C10 4.87868 10 5.58579 10 7V17C10 18.4142 10 19.1213 9.56066 19.5607C9.12132 20 8.41421 20 7 20C5.58579 20 4.87868 20 4.43934 19.5607C4 19.1213 4 18.4142 4 17V7Z"></path><path d="M14 7C14 5.58579 14 4.87868 14.4393 4.43934C14.8787 4 15.5858 4 17 4C18.4142 4 19.1213 4 19.5607 4.43934C20 4.87868 20 5.58579 20 7V17C20 18.4142 20 19.1213 19.5607 19.5607C19.1213 20 18.4142 20 17 20C15.5858 20 14.8787 20 14.4393 19.5607C14 19.1213 14 18.4142 14 17V7Z"></path></svg>',
    search: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" color="currentColor" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10C3 5.58172 3 3.37258 4.37258 2C5.74516 0.627417 7.95431 0.627417 12.3726 0.627417C16.7909 0.627417 19 0.627417 20.3726 2C21.7452 3.37258 21.7452 5.58172 21.7452 10V14C21.7452 18.4183 21.7452 20.6274 20.3726 22C19 23.3726 16.7909 23.3726 12.3726 23.3726C7.95431 23.3726 5.74516 23.3726 4.37258 22C3 20.6274 3 18.4183 3 14V10Z"></path></svg>',
    camera: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" color="currentColor" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M12.6974 3.5H11.303C10.5884 3.5 10.2311 3.5 9.91067 3.612C9.71499 3.68039 9.53113 3.77879 9.36568 3.90367C9.09474 4.10816 8.89655 4.40544 8.50018 5L8.50017 5.00001C8.29717 5.30453 7.99794 5.75337 7.87867 5.87871C7.58314 6.18927 7.19563 6.39666 6.77329 6.47029C6.60284 6.5 6.41985 6.5 6.05387 6.5C5.07379 6.5 4.58376 6.5 4.18307 6.61342C3.18074 6.89716 2.39734 7.68055 2.1136 8.68289C2.00018 9.08357 2.00018 9.57361 2.00018 10.5537V14.5C2.00018 17.3284 2.00018 18.7426 2.87886 19.6213C3.75754 20.5 5.17176 20.5 8.00018 20.5H16.0002C18.8286 20.5 20.2428 20.5 21.1215 19.6213C22.0002 18.7426 22.0002 17.3284 22.0002 14.5V10.5537C22.0002 9.57361 22.0002 9.08357 21.8868 8.68289C21.603 7.68055 20.8196 6.89716 19.8173 6.61342C19.4166 6.5 18.9266 6.5 17.9465 6.5C17.5805 6.5 17.3975 6.5 17.2271 6.47029C16.8047 6.39666 16.4172 6.18927 16.1217 5.87871C16.0024 5.75336 15.7032 5.30451 15.5002 5C15.1038 4.40544 14.9056 4.10816 14.6347 3.90367C14.4692 3.77879 14.2854 3.68039 14.0897 3.612C13.7693 3.5 13.412 3.5 12.6974 3.5Z" stroke-linejoin="round"></path><path d="M16.0002 13C16.0002 15.2091 14.2093 17 12.0002 17C9.79104 17 8.00018 15.2091 8.00018 13C8.00018 10.7909 9.79104 9 12.0002 9C14.2093 9 16.0002 10.7909 16.0002 13Z" stroke-linejoin="round"></path><path d="M19.1252 9.5H19.0002M19.2502 9.5C19.2502 9.63807 19.1383 9.75 19.0002 9.75C18.8621 9.75 18.7502 9.63807 18.7502 9.5C18.7502 9.36193 18.8621 9.25 19.0002 9.25C19.1383 9.25 19.2502 9.36193 19.2502 9.5Z"></path></svg>',
    gauge: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" color="currentColor" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z"></path><path d="M13 6.08296C12.6748 6.0284 12.3407 6 12 6C8.68629 6 6 8.68629 6 12C6 13.0929 6.29218 14.1175 6.80269 15"></path><path d="M17.917 11C17.9716 11.3252 18 11.6593 18 12C18 13.0929 17.7078 14.1175 17.1973 15"></path><path d="M12 12L16 8"></path></svg>',
    close: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" color="currentColor" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L12 12M12 12L6 18M12 12L18 18M12 12L6 6"></path></svg>',
    trophy: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" color="currentColor" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 9C19 12.866 15.866 16 12 16C8.13401 16 5 12.866 5 9C5 5.13401 8.13401 2 12 2C15.866 2 19 5.13401 19 9Z"></path><path d="M8 15V20.5128C8 21.3875 8 21.8248 8.27639 21.9634C8.55279 22.1019 8.90186 21.8395 9.6 21.3146L10.8 20.4125C11.3778 19.9782 11.6667 19.761 12 19.761C12.3333 19.761 12.6222 19.9782 13.2 20.4125L14.4 21.3146C15.0981 21.8395 15.4472 22.1019 15.7236 21.9634C16 21.8248 16 21.3875 16 20.5128V15"></path><path d="M11.6686 5.21225C11.8066 4.92946 12.1934 4.92947 12.3314 5.21225L13.1449 6.87978C13.1989 6.99046 13.3003 7.06749 13.4178 7.08703L15.1862 7.38122C15.4859 7.43108 15.6054 7.81473 15.391 8.0392L14.125 9.36513C14.0412 9.45297 14.0025 9.57736 14.021 9.69991L14.3 11.5504C14.3473 11.8638 14.0345 12.101 13.7638 11.957L12.1688 11.1083C12.0628 11.0518 11.9372 11.0518 11.8312 11.1083L10.2362 11.957C9.96554 12.101 9.65271 11.8638 9.69996 11.5504L9.979 9.69991C9.99748 9.57736 9.95882 9.45297 9.87495 9.36513L8.60896 8.0392C8.39464 7.81473 8.51408 7.43108 8.8138 7.38122L10.5822 7.08703C10.6997 7.06749 10.8011 6.99046 10.8551 6.87978L11.6686 5.21225Z"></path></svg>',
    toolbox: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" color="currentColor" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20.0004 10.9826C20.6281 10.1316 21 9.07385 21 7.92761C21 5.11556 18.7614 2.83594 16 2.83594C14.0209 2.83594 12.3104 4.00687 11.5 5.70554"></path><path d="M14.6364 21.1658H9.36364C6.67794 21.1658 5.33509 21.1658 4.40253 20.4549C4.13533 20.2512 3.89812 20.0096 3.69811 19.7375C3 18.7879 3 17.4204 3 14.6855C3 13.1226 3 12.3412 3.39892 11.7986C3.51321 11.6431 3.64876 11.505 3.80144 11.3887C4.33434 10.9824 5.10168 10.9824 6.63636 10.9824H17.3636C18.8983 10.9824 19.6657 10.9824 20.1986 11.3887C20.3512 11.505 20.4868 11.6431 20.6011 11.7986C21 12.3412 21 13.1226 21 14.6855C21 17.4204 21 18.7879 20.3019 19.7375C20.1019 20.0096 19.8647 20.2512 19.5975 20.4549C18.6649 21.1658 17.3221 21.1658 14.6364 21.1658Z"></path><path d="M10 15.0547H14"></path><path d="M13.6858 10.9826L13.335 10.1564C13.2474 9.94999 13.2565 9.71349 13.3595 9.51989L14.9144 6.59747C15.1776 6.10273 14.7982 5.48558 14.2636 5.53902L11.1099 5.85432C10.9004 5.87526 10.692 5.78776 10.5492 5.6189L8.39732 3.07491C8.03241 2.64349 7.37203 2.82539 7.26584 3.38656L6.63969 6.69573C6.59813 6.91538 6.46021 7.09827 6.26863 7.18779L3.38401 8.53572C2.89509 8.76418 2.86669 9.49366 3.33529 9.78682L5.24666 10.9826"></path></svg>',
    exit: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" color="currentColor" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12.8924 2.80982L21.4876 9.59547C21.8112 9.85095 22 10.2405 22 10.6528C22 11.3969 21.3969 12 20.6528 12H20V15.5C20 18.3284 20 19.7426 19.1213 20.6213C18.2426 21.5 16.8284 21.5 14 21.5H10C7.17157 21.5 5.75736 21.5 4.87868 20.6213C4 19.7426 4 18.3284 4 15.5V12H3.34716C2.60315 12 2 11.3969 2 10.6528C2 10.2405 2.1888 9.85095 2.5124 9.59547L11.1076 2.80982C11.3617 2.60915 11.6761 2.5 12 2.5C12.3239 2.5 12.6383 2.60915 12.8924 2.80982Z"></path><path d="M14.5 21.5V17C14.5 16.0654 14.5 15.5981 14.299 15.25C14.1674 15.022 13.978 14.8326 13.75 14.701C13.4019 14.5 12.9346 14.5 12 14.5C11.0654 14.5 10.5981 14.5 10.25 14.701C10.022 14.8326 9.83261 15.022 9.70096 15.25C9.5 15.5981 9.5 16.0654 9.5 17V21.5"></path></svg>'
  };

  /* ---------------- bookmark helpers ---------------- */
  function getBookmarkKey() { return "bookmarks"; }
  function isBookmarked() {
    try {
      var list = JSON.parse(localStorage.getItem(getBookmarkKey()) || "[]");
      return list.indexOf(CFG.cleanName) > -1;
    } catch (e) { return false; }
  }
  function toggleBookmark() {
    var list;
    try { list = JSON.parse(localStorage.getItem(getBookmarkKey()) || "[]"); } catch (e) { list = []; }
    var idx = list.indexOf(CFG.cleanName);
    var nowBookmarked;
    if (idx > -1) { list.splice(idx, 1); nowBookmarked = false; }
    else { list.push(CFG.cleanName); nowBookmarked = true; }
    setStore(getBookmarkKey(), JSON.stringify(list));
    window.dispatchEvent(new CustomEvent("phantom-bookmark-change", { detail: { bookmarked: nowBookmarked } }));
    return nowBookmarked;
  }

  /* ---------------- build DOM ---------------- */
  function exitIcon() {
    var live = document.getElementById("ctrl-home");
    if (live && live.innerHTML && live.innerHTML.indexOf("<svg") === 0) return live.innerHTML;
    return ICON.exit;
  }
  function option(id, icon, label, note, on, locked) {
    return (
      '<button type="button" class="tb-opt' + (on ? " on" : "") + (locked ? " locked" : "") + '" data-opt="' + id + '"' + (locked ? " disabled" : "") + ">" +
      '<span class="tb-opt-ico">' + icon + "</span>" +
      '<span class="tb-opt-label">' + label + (note ? '<div class="tb-opt-note">' + note + "</div>" : "") + "</span>" +
      '<span class="tb-toggle" aria-hidden="true"></span>' +
      "</button>"
    );
  }

  function buildOverlay() {
    var wrap = document.createElement("div");
    wrap.id = "phantom-toolbox";
    var quick = store("phantom-btn-collapse", "1") === "1" && store("phantom-btn-exit", "1") === "1" ? "" : "";
    var bookmarkOn = isBookmarked();
    wrap.innerHTML =
      '<div class="tb-backdrop"></div>' +
      '<div class="tb-display">' +
      '<div class="tb-tabs">' +
      '<button type="button" class="tb-tab active" data-tab="quick" title="Quick Settings">' + ICON.gear + "</button>" +
      '<button type="button" class="tb-tab" data-tab="display" title="Display">' + ICON.display + "</button>" +
      '<button type="button" class="tb-tab tb-tab-close" data-tab="close" title="Close">' + ICON.close + "</button>" +
      "</div>" +
      '<div class="tb-panel active" data-panel="quick">' +
      '<div class="tb-quick">' +
      '<button type="button" class="tb-quick-btn' + (bookmarkOn ? " on" : "") + '" data-opt="bookmark" title="' + (bookmarkOn ? "Remove bookmark" : "Bookmark game") + '">' + ICON.bookmark + "</button>" +
      '<button type="button" class="tb-quick-btn" data-opt="pause" title="Pause game">' + ICON.pause + "</button>" +
      '<button type="button" class="tb-quick-btn" data-opt="leaderboard" title="Leaderboard">' + ICON.trophy + "</button>" +
      '<button type="button" class="tb-quick-btn" data-opt="exit" title="Exit game">' + exitIcon() + "</button>" +
      "</div>" +
      '<div class="tb-board" data-board hidden></div>' +
      "</div>" +
      '<div class="tb-panel" data-panel="display">' +
      option("btn-collapse", ICON.gear, "Collapse button", "Show / hide the controls bar", store("phantom-btn-collapse", "1") === "1", false) +
      option("btn-exit", exitIcon(), "Exit button", "Leave the game", store("phantom-btn-exit", "1") === "1", true) +
      option("btn-toolbox", ICON.toolbox, "Toolbox button", "Open this toolbox", store("phantom-btn-toolbox", "1") === "1", true) +
      option("btn-bookmark", ICON.bookmark, "Bookmark button", "Quick bookmark in the controls bar", store("phantom-btn-bookmark", "1") === "1", false) +
      option("btn-screenshot", ICON.camera, "Screenshot button", "Download a shot of the game", store("phantom-btn-screenshot", "0") === "1", false) +
      option("fps", ICON.gauge, "FPS display", "Live frames-per-second counter", store("phantom-fps", "0") === "1", false) +
      option("btn-pause", ICON.pause, "Pause button", "One-tap pause in the controls bar", store("phantom-btn-pause", "0") === "1", false) +
      "</div>" +
      "</div>";
    document.body.appendChild(wrap);
    return wrap;
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  /* ---------------- behaviour ---------------- */
  function pauseGame() {
    if (window.__setPaused) window.__setPaused(true, true);
  }
  function resumeGame() {
    if (window.__setPaused) window.__setPaused(false);
  }

  function openToolbox() {
    if (!overlay) return;
    syncBookmarkUI();
    overlay.classList.add("open");
    pauseGame();
    if (window.grainient && window.grainient.showProfileCard) window.grainient.showProfileCard();
  }

  function closeToolbox() {
    if (!overlay) return;
    overlay.classList.remove("open");
    if (window.grainient && window.grainient.hideProfileCard) window.grainient.hideProfileCard();
    resumeGame();
  }

  var overlay = buildOverlay();

  function switchTab(tab) {
    overlay.querySelectorAll(".tb-tab").forEach(function (b) {
      b.classList.toggle("active", b.dataset.tab === tab);
    });
    overlay.querySelectorAll(".tb-panel").forEach(function (p) {
      p.classList.toggle("active", p.dataset.panel === tab);
    });
  }

  overlay.querySelectorAll(".tb-tab").forEach(function (b) {
    b.addEventListener("click", function () {
      if (b.dataset.tab === "close") closeToolbox();
      else switchTab(b.dataset.tab);
    });
  });
  var backdrop = overlay.querySelector(".tb-backdrop");
  backdrop.addEventListener("click", closeToolbox);

  /* ---------------- mini leaderboard ---------------- */
  var boardLoaded = false;
  function boardProfilePic(r) {
    if (!r) return null;
    if (r.avatarPath) return (window.DB && window.DB.avatarUrl) ? window.DB.avatarUrl(r.avatarPath) : r.avatarPath;
    if (r.avatar && r.avatar.type === "image") return r.avatar.data || r.avatar.url || null;
    return null;
  }
  function boardAccent(r) {
    var a = (r && r.avatar) || {};
    var accent = a.accent || "";
    var color = a.color || "#22c55e";
    return accent || (/^#[0-9a-f]{3,8}$/i.test(color) ? color : "#22c55e");
  }
  function boardIconColor(r) {
    return ((r && r.avatar && r.avatar.accent) ? "#111827" : "#fff");
  }
  function mineLocal() {
    try { return (JSON.parse(localStorage.getItem("social.v1") || "null") || {}).profile || null; } catch (e) { return null; }
  }
  var boardRows = [];
  var boardSort = "playtime"; /* "playtime" | "level" */
  function boardLevel(r) {
    return r.level || (Math.floor(Math.sqrt(Math.max(0, r.totalPlaytime || 0) / 60)) + 1);
  }
  function fmtPlaytime(s) {
    s = Math.floor(Number(s) || 0);
    if (s <= 0) return "0s";
    var m = Math.floor(s / 60), h = Math.floor(m / 60);
    var z = s % 60, mm = m % 60;
    if (h) return h + "h " + mm + "m";
    if (m) return m + "m " + z + "s";
    return z + "s";
  }
  function boardValue(r) {
    return boardSort === "level" ? boardLevel(r) : (Number(r.totalPlaytime) || 0);
  }
  function renderBoard() {
    var board = overlay.querySelector(".tb-board");
    if (!board) return;
    var me = mineLocal();
    var myName = me && me.username ? String(me.username) : null;
    var rows = boardRows.slice().sort(function (a, b) { return boardValue(b) - boardValue(a); }).slice(0, 10);

    var header =
      '<div class="tb-board-head">' +
      '<button type="button" class="tb-board-toggle" data-board-sort>' +
      '<span class="tb-board-toggle-opt' + (boardSort === "playtime" ? " on" : "") + '" data-sort="playtime">Playtime</span>' +
      '<span class="tb-board-toggle-opt' + (boardSort === "level" ? " on" : "") + '" data-sort="level">Level</span>' +
      "</button>" +
      "</div>";

    var list = "";
    rows.forEach(function (r, i) {
      var name = r.username || r.name || "Player";
      var isMe = (r.isMe) || (myName && name === myName);
      var pic = boardProfilePic(r);
      var level = boardLevel(r);
      var av = pic
        ? '<img src="' + escapeHtml(String(pic)) + '" alt="">'
        : '<span class="tb-board-av-icon" style="background:' + escapeHtml(boardAccent(r)) + ";color:" + boardIconColor(r) + '">' +
          (window.ACCOUNT_ICON || '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>') +
          "</span>";
      var valueHtml;
      if (boardSort === "level") {
        valueHtml = '<span class="tb-board-lv">Lv ' + level + "</span>";
      } else {
        valueHtml = '<span class="tb-board-time">' + escapeHtml(fmtPlaytime(r.totalPlaytime)) + "</span>";
      }
      list +=
        '<div class="tb-board-row' + (isMe ? " me" : "") + '">' +
        '<span class="tb-board-rank">' + (i + 1) + "</span>" +
        '<span class="tb-board-av">' + av + "</span>" +
        '<span class="tb-board-name">' + escapeHtml(name) + "</span>" +
        valueHtml +
        "</div>";
    });
    if (!rows.length) list = '<div class="tb-board-loading">No players yet</div>';
    board.innerHTML = header + '<div class="tb-board-list">' + list + "</div>";
  }
  function toggleBoard() {
    var board = overlay.querySelector(".tb-board");
    var display = overlay.querySelector(".tb-display");
    if (!board) return;
    var show = board.hasAttribute("hidden");
    if (!show) {
      board.setAttribute("hidden", "");
      if (display) display.classList.remove("board-open");
      return;
    }
    board.removeAttribute("hidden");
    if (display) display.classList.add("board-open");
    if (boardLoaded) return;
    board.innerHTML = '<div class="tb-board-loading">Loading…</div>';
    if (window.DB && window.DB.getLeaderboard) {
      window.DB.getLeaderboard(50).then(function (rows) {
        boardLoaded = true;
        boardRows = rows || [];
        renderBoard();
      }).catch(function () {
        board.innerHTML = '<div class="tb-board-loading">Could not load</div>';
      });
    } else {
      board.innerHTML = '<div class="tb-board-loading">Leaderboard unavailable</div>';
    }
  }

  overlay.addEventListener("click", function (e) {
    var sortBtn = e.target.closest("[data-board-sort]");
    if (sortBtn) {
      var opt = e.target.closest("[data-sort]");
      if (opt) {
        var want = opt.dataset.sort;
        if (want !== boardSort) { boardSort = want; renderBoard(); }
      }
      return;
    }
    var btn = e.target.closest(".tb-opt") || e.target.closest(".tb-quick-btn");
    if (!btn || btn.classList.contains("locked")) return;
    var id = btn.dataset.opt;
    if (id === "bookmark") {
      var now = toggleBookmark();
      btn.classList.toggle("on", now);
      btn.title = now ? "Remove bookmark" : "Bookmark game";
      var label = btn.querySelector(".tb-opt-label");
      if (label) label.textContent = now ? "Remove bookmark" : "Bookmark game";
    } else if (id === "pause") {
      closeToolbox();
      if (window.__setPaused) window.__setPaused(true);
    } else if (id === "leaderboard") {
      toggleBoard();
    } else if (id === "exit") {
      var exitBtn = document.getElementById("ctrl-home");
      if (exitBtn) exitBtn.click();
    } else if (id === "more") {
      var url = "index.html?view=explore&genre=" + encodeURIComponent(CFG.genre || "");
      window.open(url, "_blank");
    } else if (id === "fps") {
      var on = btn.classList.toggle("on");
      setStore("phantom-fps", on ? "1" : "0");
      setFps(on);
    } else if (id.indexOf("btn-") === 0) {
      var name = id.slice(4);
      var isOn = btn.classList.toggle("on");
      if (id === "btn-exit" || id === "btn-toolbox") {
        btn.classList.add("on"); /* locked on */
        isOn = true;
      }
      setStore("phantom-btn-" + name, isOn ? "1" : "0");
      applyControlButtons();
      window.dispatchEvent(new CustomEvent("phantom-display-change"));
    }
  });

  /* ---------------- optional control buttons ---------------- */
  function controlsWrap() { return document.getElementById("ctrl-actions") || document.getElementById("controls"); }

  function makeBtn(id, icon, title, onClick) {
    var b = document.createElement("button");
    b.className = "ctrl-extra-btn";
    b.id = id;
    b.title = title;
    b.innerHTML = icon;
    b.addEventListener("click", function (e) { e.stopPropagation(); onClick(b); });
    return b;
  }

  function applyControlButtons() {
    var wrap = document.getElementById("extra-controls");
    if (!wrap) return;
    wrap.innerHTML = "";
    if (store("phantom-btn-bookmark", "1") === "1") {
      var bm = makeBtn("ctrl-bookmark", ICON.bookmark, "Bookmark", function () { toggleBookmark(); });
      bm.classList.toggle("bookmarked", isBookmarked());
      wrap.appendChild(bm);
    }
    if (store("phantom-btn-screenshot", "0") === "1") {
      wrap.appendChild(makeBtn("ctrl-screenshot", ICON.camera, "Screenshot", function () { takeScreenshot(); }));
    }
    if (store("phantom-btn-pause", "0") === "1") {
      wrap.appendChild(makeBtn("ctrl-pause", ICON.pause, "Pause", function () {
        if (window.__setPaused) window.__setPaused(true);
      }));
    }
  }

  /* Keep the bar bookmark button's filled state in sync. */
  window.addEventListener("phantom-bookmark-change", function () {
    var bm = document.getElementById("ctrl-bookmark");
    if (bm) bm.classList.toggle("bookmarked", isBookmarked());
  });

  /* ---------------- screenshot ---------------- */
  function takeScreenshot() {
    var frame = CFG.gameFrame && CFG.gameFrame();
    var base = CFG.cleanName || "game";
    var stamp = new Date().toISOString().replace(/[:.]/g, "-");
    var filename = base + "-" + stamp + ".png";
    if (frame && frame.tagName === "IFRAME") {
      try {
        var doc = frame.contentDocument;
        if (!doc) throw new Error("cross-origin");
        var srcCanvas = doc.querySelector("canvas");
        if (srcCanvas) {
          downloadCanvas(srcCanvas, filename);
          flashMessage("Screenshot saved");
          return;
        }
      } catch (e) {
        flashMessage("Screenshot blocked (game is cross-origin)");
        return;
      }
    }
    /* Fallback: grab the visible viewport with the UI hidden. */
    captureFallback(filename);
  }

  function flashMessage(text) {
    var el = document.createElement("div");
    el.textContent = text;
    el.style.cssText = "position:fixed;left:50%;bottom:36px;transform:translateX(-50%);z-index:400;padding:10px 18px;border-radius:12px;background:rgba(0,0,0,0.7);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,0.16);color:#fff;font:600 14px sans-serif;";
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 2200);
  }

  function downloadCanvas(canvas, filename) {
    var out = document.createElement("canvas");
    out.width = canvas.width;
    out.height = canvas.height;
    out.getContext("2d").drawImage(canvas, 0, 0);
    out.toBlob(function (blob) {
      if (!blob) return;
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    });
  }

  /* Viewport capture without third-party libs: draw the game canvas / flash
     element by hand rather than rasterizing the DOM, so the overlay UI never
     ends up in the shot. */
  function captureFallback(filename) {
    var frame = CFG.gameFrame && CFG.gameFrame();
    var target = null;
    if (frame) {
      if (frame.tagName === "CANVAS") target = frame;
      else if (frame.tagName === "IFRAME") {
        try {
          var c = frame.contentDocument && frame.contentDocument.querySelector("canvas");
          if (c) target = c;
        } catch (e) {}
      }
    }
    if (!target) {
      /* Ruffle renders into an inner canvas / element. */
      var ruffle = document.querySelector("ruffle-player");
      if (ruffle) {
        target = ruffle.querySelector("canvas");
      }
    }
    if (target && target.tagName === "CANVAS") {
      downloadCanvas(target, filename);
      flashMessage("Screenshot saved");
    } else {
      flashMessage("Screenshot not available for this game");
    }
  }

  /* ---------------- FPS counter ---------------- */
  var fpsEl = null;
  var rafId = 0;
  var fpsOn = false;
  var frames = 0;
  var fpsLast = 0;
  function loopFps(now) {
    if (!fpsOn) return;
    frames++;
    if (now - fpsLast >= 1000) {
      if (fpsEl) fpsEl.textContent = frames;
      frames = 0;
      fpsLast = now;
    }
    rafId = requestAnimationFrame(loopFps);
  }
  function syncFpsTop() {
    if (!fpsEl) return;
    var bar = document.getElementById("controls");
    if (!bar) return;
    var top = bar.style.top || getComputedStyle(bar).top || "16px";
    fpsEl.style.top = top;
  }
  function setFps(on) {
    fpsOn = on;
    if (!fpsEl) {
      fpsEl = document.createElement("div");
      fpsEl.id = "fps-counter";
      fpsEl.textContent = "0";
      document.body.appendChild(fpsEl);
    }
    fpsEl.classList.toggle("on", on);
    if (on) {
      syncFpsTop();
      frames = 0;
      fpsLast = performance.now();
      rafId = requestAnimationFrame(loopFps);
    } else {
      cancelAnimationFrame(rafId);
    }
  }

  /* ---------------- external open (path: ctrl-pause) ---------------- */
  window.__openToolbox = openToolbox;
  window.__closeToolbox = closeToolbox;

  /* React to bookmark changes from anywhere. */
  window.addEventListener("phantom-bookmark-change", function () {
    var btn = overlay.querySelector('[data-opt="bookmark"]');
    if (!btn) return;
    var now = isBookmarked();
    btn.classList.toggle("on", now);
    btn.title = now ? "Remove bookmark" : "Bookmark game";
    var label = btn.querySelector(".tb-opt-label");
    if (label) label.textContent = now ? "Remove bookmark" : "Bookmark game";
  });

  /* The page publishes the game name after this script runs, so the state
     painted while building the overlay can be stale. Re-read it once the
     context is ready and whenever the toolbox opens. */
  function syncBookmarkUI() {
    var on = isBookmarked();
    var quick = overlay.querySelector('[data-opt="bookmark"]');
    if (quick) {
      quick.classList.toggle("on", on);
      quick.title = on ? "Remove bookmark" : "Bookmark game";
      var label = quick.querySelector(".tb-opt-label");
      if (label) label.textContent = on ? "Remove bookmark" : "Bookmark game";
    }
    var bar = document.getElementById("ctrl-bookmark");
    if (bar) bar.classList.toggle("bookmarked", on);
  }
  window.addEventListener("phantom-context-ready", syncBookmarkUI);

  /* ---------------- init ---------------- */
  function init() {
    applyControlButtons();
    var bar = document.getElementById("controls");
    if (bar && window.MutationObserver) {
      new MutationObserver(syncFpsTop).observe(bar, { attributes: true, attributeFilter: ["style"] });
    }
    if (store("phantom-fps", "0") === "1") setFps(true);
    if (P.initialView) openToolbox();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();

/* ---------------- in-call pill ----------------
   The call itself runs in the app tab (index.html). These pages mirror it
   through localStorage: "rcdn-call-live" carries who is in the call and the
   call's state, while button presses go back as "rcdn-call-cmd". No audio
   is captured here - this is display and remote control only. */
(function () {
  "use strict";
  var LIVE_KEY = "rcdn-call-live", CMD_KEY = "rcdn-call-cmd", STALE_MS = 15000;
  var MIC_ON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" color="currentColor" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7 6.5C7 4.01472 9.01472 2 11.5 2C13.9853 2 16 4.01472 16 6.5V11.5C16 13.9853 13.9853 16 11.5 16C9.01472 16 7 13.9853 7 11.5V6.5Z"></path><path d="M11.5 19H11.0828C7.57267 19 4.57706 16.4623 4 13M11.5 19H11.9172C15.4273 19 18.4229 16.4623 19 13M11.5 19V22"></path></svg>';
  var MIC_OFF = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" color="currentColor" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8.1572 4.1572C8.94761 2.86349 10.373 2 12 2C14.4853 2 16.5 4.01472 16.5 6.5V11.5C16.5 11.8111 16.4684 12.1149 16.4083 12.4083M7.5 7.5V11.5C7.5 13.9853 9.51472 16 12 16C13.1154 16 14.136 15.5942 14.9222 14.9222"></path><path d="M2 2L22 22"></path><path d="M12 19H11.5828C8.07267 19 5.07706 16.4623 4.5 13M12 19H12.4172C14.2325 19 15.9102 18.3213 17.1869 17.1869M12 19V22M19.5 13C19.3878 13.6733 19.1841 14.3116 18.903 14.903"></path></svg>';
  var CAM_ON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" color="currentColor" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M12.6974 3.5H11.303C10.5884 3.5 10.2311 3.5 9.91067 3.612C9.71499 3.68039 9.53113 3.77879 9.36568 3.90367C9.09474 4.10816 8.89655 4.40544 8.50018 5L8.50017 5.00001C8.29717 5.30453 7.99794 5.75337 7.87867 5.87871C7.58314 6.18927 7.19563 6.39666 6.77329 6.47029C6.60284 6.5 6.41985 6.5 6.05387 6.5C5.07379 6.5 4.58376 6.5 4.18307 6.61342C3.18074 6.89716 2.39734 7.68055 2.1136 8.68289C2.00018 9.08357 2.00018 9.57361 2.00018 10.5537V14.5C2.00018 17.3284 2.00018 18.7426 2.87886 19.6213C3.75754 20.5 5.17176 20.5 8.00018 20.5H16.0002C18.8286 20.5 20.2428 20.5 21.1215 19.6213C22.0002 18.7426 22.0002 17.3284 22.0002 14.5V10.5537C22.0002 9.57361 22.0002 9.08357 21.8868 8.68289C21.603 7.68055 20.8196 6.89716 19.8173 6.61342C19.4166 6.5 18.9266 6.5 17.9465 6.5C17.5805 6.5 17.3975 6.5 17.2271 6.47029C16.8047 6.39666 16.4172 6.18927 16.1217 5.87871C16.0024 5.75336 15.7032 5.30451 15.5002 5C15.1038 4.40544 14.9056 4.10816 14.6347 3.90367C14.4692 3.77879 14.2854 3.68039 14.0897 3.612C13.7693 3.5 13.412 3.5 12.6974 3.5Z" stroke-linejoin="round"></path><path d="M16.0002 13C16.0002 15.2091 14.2093 17 12.0002 17C9.79104 17 8.00018 15.2091 8.00018 13C8.00018 10.7909 9.79104 9 12.0002 9C14.2093 9 16.0002 10.7909 16.0002 13Z" stroke-linejoin="round"></path><path d="M19.1252 9.5H19.0002M19.2502 9.5C19.2502 9.63807 19.1383 9.75 19.0002 9.75C18.8621 9.75 18.7502 9.63807 18.7502 9.5C18.7502 9.36193 18.8621 9.25 19.0002 9.25C19.1383 9.25 19.2502 9.36193 19.2502 9.5Z"></path></svg>';
  var CAM_OFF = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" color="currentColor" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M9.71586 9.71484C8.6787 10.4376 8 11.639 8 12.999C8 15.2081 9.79086 16.999 12 16.999C13.36 16.999 14.5614 16.3203 15.2841 15.2831" stroke-linejoin="round"></path><path d="M2 2L22 22" stroke-linejoin="round"></path><path d="M6.49597 6.49597C6.38143 6.5 6.24171 6.5 6.05369 6.5C5.07361 6.5 4.58357 6.5 4.18289 6.61342C3.18055 6.89716 2.39716 7.68055 2.11342 8.68289C2 9.08357 2 9.57361 2 10.5537V14.5C2 17.3284 2 18.7426 2.87868 19.6213C3.75736 20.5 5.17157 20.5 8 20.5H16C18 20.5 19.2929 20.5 20.1893 20.1893M21.878 17.878C22 17.0498 22 15.9645 22 14.5V10.5537C22 9.57361 22 9.08357 21.8866 8.68289C21.6028 7.68055 20.8194 6.89716 19.8171 6.61342C19.4164 6.5 18.9264 6.5 17.9463 6.5C17.5803 6.5 17.3973 6.5 17.2269 6.47029C16.8046 6.39666 16.417 6.18927 16.1215 5.87871C16.0022 5.75336 15.703 5.30451 15.5 5C15.1036 4.40544 14.9054 4.10816 14.6345 3.90367C14.4691 3.77879 14.2852 3.68039 14.0895 3.612C13.7691 3.5 13.4118 3.5 12.6972 3.5H11.3028C10.5882 3.5 10.2309 3.5 9.91048 3.612C9.7148 3.68039 9.53094 3.77879 9.36549 3.90367C9.14445 4.07051 8.97183 4.2991 8.7005 4.7005" stroke-linejoin="round"></path><path d="M19.125 9.5H19M19.25 9.5C19.25 9.63807 19.1381 9.75 19 9.75C18.8619 9.75 18.75 9.63807 18.75 9.5C18.75 9.36193 18.8619 9.25 19 9.25C19.1381 9.25 19.25 9.36193 19.25 9.5Z"></path></svg>';
  var LEAVE = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" width=\"18\" height=\"18\" color=\"currentColor\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M15 17L20 12L15 7\" /><path d=\"M4 12H20\" /><path d=\"M4 12C4 7.58172 7.58172 4 12 4M4 12C4 16.4183 7.58172 20 12 20\" /></svg>";
  var CSS = ".call-float{position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:520;display:flex;align-items:center;gap:10px;padding:8px 10px 8px 12px;border-radius:999px;background:rgba(18,18,22,.86);color:#fff;border:1px solid rgba(255,255,255,.12);box-shadow:0 18px 44px -20px rgba(0,0,0,.85);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);cursor:pointer;transition:transform .16s ease}.call-float[hidden]{display:none}.call-float:hover{transform:translate(-50%,-2px)}.call-float-stack{position:relative;flex:none;width:72px;height:50px;align-self:center}.call-float-av{position:absolute;display:flex;align-items:center;justify-content:center;border-radius:50%;overflow:hidden;border:2px solid rgba(18,18,22,.95);background:#2a2a2f;box-shadow:0 2px 10px -3px rgba(0,0,0,.75);color:#fff;font-weight:700;font-size:13px}.call-float-av[data-i=\"0\"]{width:38px;height:38px;left:0;top:8px;z-index:1}.call-float-av[data-i=\"1\"]{width:31px;height:31px;left:20px;top:0;z-index:2;font-size:12px}.call-float-av[data-i=\"2\"]{width:27px;height:27px;left:33px;top:19px;z-index:3;font-size:11px}.call-float-av[data-i=\"3\"]{width:22px;height:22px;left:44px;top:3px;z-index:4;font-size:10px}.call-float-av:only-child{left:0;top:4px}.call-float-av img{width:100%;height:100%;object-fit:cover}.call-float-av .msg-avatar{width:100%;height:100%;display:flex;align-items:center;justify-content:center;line-height:0}.call-float-av .msg-avatar svg{width:60%;height:60%}.call-float-av .msg-avatar img{width:100%;height:100%;object-fit:cover}.call-float-more{margin-left:-2px;font-size:11px;font-weight:700;opacity:.7}.call-float-info{display:flex;flex-direction:column;line-height:1.15}.call-float-title{font-size:12px;font-weight:700}.call-float-sub{font-size:11px;opacity:.7;white-space:nowrap}.call-float-actions{display:flex;align-items:center;gap:6px}.call-float-btn{width:34px;height:34px;padding:0;border:0;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;background:rgba(255,255,255,.12);color:#fff;cursor:pointer;transition:background .15s ease}.call-float-btn:hover{background:rgba(255,255,255,.22)}.call-float-btn.off{background:#ef4444}.call-float-btn.danger{background:#ef4444}.call-float-btn.danger:hover{background:#dc2626}.call-float-btn svg{width:18px;height:18px}@media (max-width:560px){.call-float{top:10px;gap:8px;padding:6px 8px 6px 10px}.call-float-info{display:none}}";
  var el = null, stackEl = null, subEl = null, stackSig = "", btnSig = "";
  function read() {
    try { return JSON.parse(localStorage.getItem(LIVE_KEY) || "null"); } catch (e) { return null; }
  }
  function fmt(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    return ("0" + Math.floor(s / 60)).slice(-2) + ":" + ("0" + (s % 60)).slice(-2);
  }
  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c];
    });
  }
  function send(cmd) {
    try { localStorage.setItem(CMD_KEY, JSON.stringify({ cmd: cmd, n: Date.now() + "-" + Math.random() })); } catch (e) {}
  }
  /* The call itself lives in the app page. When a game takes over this tab that
     page is gone, so we host it in a hidden iframe: it rejoins from the saved
     call session and the pill's buttons drive it through the same commands. */
  function hasSession() {
    try { return !!sessionStorage.getItem("rcdn-call-session"); } catch (e) { return false; }
  }
  function ensureHost() {
    if (document.getElementById("call-host")) return;
    var f = document.createElement("iframe");
    f.id = "call-host";
    f.setAttribute("allow", "camera; microphone; autoplay; display-capture");
    f.setAttribute("title", "call host");
    f.src = "index.html?view=calls&embedded=1";
    f.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none;z-index:-1";
    document.body.appendChild(f);
  }
  function dropHost() {
    var f = document.getElementById("call-host");
    if (f && f.parentNode) f.parentNode.removeChild(f);
  }
  function render() {
    if (!el) return;
    var st = read();
    var people = (st && st.people) || [];
    var fresh = people.length > 0 && (Date.now() - (st.updatedAt || 0) < STALE_MS);
    var inSession = hasSession();
    /* Stay on screen for as long as a call session exists: while the hosted page
       is starting up the published state is briefly out of date, and hiding the
       card in that gap is what made it come and go. */
    if (!people.length || (!fresh && !inSession)) {
      el.hidden = true;
      stackSig = "";
      btnSig = "";
      if (inSession) ensureHost(); else dropHost();
      return;
    }
    if (inSession) ensureHost();
    el.hidden = false;
    /* rebuild the pile only when the people change: this runs every second for
       the clock, and re-writing the avatar markup each tick flickers */
    var nextStack = JSON.stringify(people);
    if (nextStack !== stackSig) {
      stackSig = nextStack;
      var shown = Math.min(people.length, 4);
      stackEl.style.width = ({ 1: 42, 2: 57, 3: 66, 4: 72 })[shown] + "px";
      var out = "";
      for (var i = 0; i < shown; i++) {
        var p = people[i];
        var inner = p.html ? p.html : (p.img ? '<img src="' + esc(p.img) + '" alt="">' : esc(String(p.name || "?").slice(0, 1).toUpperCase()));
        out += '<span class="call-float-av" data-i="' + i + '" style="background:' + esc(p.color || "#3f3f46") + '">' + inner + "</span>";
      }
      if (people.length > 4) out += '<span class="call-float-more">+' + (people.length - 4) + "</span>";
      stackEl.innerHTML = out;
    }
    var nextBtn = (st.micOn ? "1" : "0") + (st.camOn ? "1" : "0");
    if (nextBtn !== btnSig) {
      btnSig = nextBtn;
      var mb = el.querySelector('[data-cf="mic"]'), cb = el.querySelector('[data-cf="cam"]');
      if (mb) { mb.innerHTML = st.micOn ? MIC_ON : MIC_OFF; mb.className = "call-float-btn" + (st.micOn ? "" : " off"); }
      if (cb) { cb.innerHTML = st.camOn ? CAM_ON : CAM_OFF; cb.className = "call-float-btn" + (st.camOn ? "" : " off"); }
    }
    var dur = !fresh ? "Reconnecting..."
      : (st.state === "active" ? fmt(Date.now() - (st.startedAt || Date.now())) : "Connecting...");
    subEl.textContent = (people.length > 1 ? people.length + " people · " : "") + dur;
  }
  function bootInner() {
    if (document.getElementById("call-float")) return;
    var style = document.createElement("style");
    style.id = "call-float-style";
    style.textContent = CSS;
    document.head.appendChild(style);
    el = document.createElement("div");
    el.id = "call-float";
    el.className = "call-float";
    el.hidden = true;
    el.title = "Open the call";
    el.innerHTML = '<div class="call-float-stack"></div>'
      + '<div class="call-float-info"><span class="call-float-title">In call</span><span class="call-float-sub"></span></div>'
      + '<div class="call-float-actions">'
      + '<button class="call-float-btn" type="button" data-cf="mic" aria-label="Toggle mic"></button>'
      + '<button class="call-float-btn" type="button" data-cf="cam" aria-label="Toggle camera"></button>'
      + '<button class="call-float-btn danger" type="button" data-cf="leave" aria-label="Leave call">' + LEAVE + '</button>'
      + '</div>';
    document.body.appendChild(el);
    stackEl = el.querySelector(".call-float-stack");
    subEl = el.querySelector(".call-float-sub");
    el.addEventListener("click", function (e) {
      var b = e.target && e.target.closest ? e.target.closest("[data-cf]") : null;
      if (!b) { window.location.href = "index.html?view=calls"; return; }
      send(b.getAttribute("data-cf"));
    });
    window.addEventListener("storage", function (e) { if (!e || e.key === LIVE_KEY) render(); });
    setInterval(render, 1000);
    render();
  }
  /* never let a problem here take the page down with it */
  function boot() {
    try { bootInner(); } catch (err) { try { console.warn("[call pill]", err); } catch (e) {} }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
