(function (nonce) {
  'use strict';
  if (window.__EAC_UPDATE_UI__) window.__EAC_UPDATE_UI__.release();
  var shield = document.createElement('div');
  shield.id = '__eac_update_preparing__';
  shield.setAttribute('role', 'status');
  shield.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;background:rgba(20,25,34,.8);color:white;font:16px system-ui';
  shield.textContent = '正在保存数据以准备更新，请等待。';
  function block(event) {event.preventDefault();event.stopImmediatePropagation();}
  var events = ['keydown','beforeinput','pointerdown','click','submit','paste','drop'];
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  events.forEach(function (event) {document.addEventListener(event, block, true);});
  document.body.appendChild(shield);
  window.__EAC_UPDATE_UI__ = {release: function () {
    events.forEach(function (event) {document.removeEventListener(event, block, true);});
    shield.remove();delete window.__EAC_UPDATE_UI__;
  }};
  requestAnimationFrame(function () {requestAnimationFrame(function () {
    var preferences = {}; var draftValues = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (key && (key === 'dsh.conversation' || key.indexOf('dsh.conversation.') === 0 || key === 'dsh.locale')) {
          var value = localStorage.getItem(key);
          if (value !== null) preferences[key] = value;
          if ((key === 'dsh.conversation' || key.indexOf('dsh.conversation.') === 0) && value !== null) {
            var data = JSON.parse(value);if (typeof data.draft === 'string') draftValues.push(data.draft.trim());
          }
        }
      }
      var editors = document.querySelectorAll('[data-composer-input][contenteditable="true"]');
      var draftSaved = Array.prototype.every.call(editors, function (editor) {
        var text = (editor.innerText || editor.textContent || '').trim();
        return !text || draftValues.indexOf(text) >= 0;
      });
      if (!editors.length && document.querySelector('[contenteditable="true"]')) draftSaved = false;
      // Unsent attachments live in the composer machine rather than the persisted draft.
      if (document.querySelector('[data-composer-card] [class$="_rail"], [data-composer-card] img[src^="blob:"]')) draftSaved = false;
      window.dshDesktop._call('client-update.ui-checkpoint', {nonce:nonce,origin:location.origin,preferences:preferences,draftSaved:draftSaved})
        .catch(function () {window.__EAC_UPDATE_UI__ && window.__EAC_UPDATE_UI__.release();});
    } catch (error) {
      window.dshDesktop._call('client-update.ui-checkpoint', {nonce:nonce,origin:location.origin,draftSaved:false,preferences:{}})
        .catch(function () {});
    }
  });});
})
