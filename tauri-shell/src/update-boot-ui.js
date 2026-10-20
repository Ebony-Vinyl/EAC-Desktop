(function (checkpoint) {
  'use strict';
  function freeze() {
    if (window.__EAC_UPDATE_BOOT__) return;
    var block = function (event) {event.preventDefault();event.stopImmediatePropagation();};
    var events = ['keydown','beforeinput','pointerdown','click','submit','paste','drop'];
    events.forEach(function (event) {document.addEventListener(event, block, true);});
    var shield = document.createElement('div');shield.id = '__eac_update_boot__';shield.setAttribute('role','status');
    shield.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;background:rgba(20,25,34,.85);color:white;font:16px system-ui';
    shield.textContent = '正在验证更新与原有数据，请等待。';document.body.appendChild(shield);
    window.__EAC_UPDATE_BOOT__ = {release:function () {events.forEach(function (event) {document.removeEventListener(event,block,true);});shield.remove();delete window.__EAC_UPDATE_BOOT__;}};
  }
  function run() {
    freeze();
    if (!checkpoint || location.origin !== checkpoint.origin || !window.dshDesktop) return;
    var readable = false;
    try {
      readable = Object.keys(checkpoint.preferences).every(function (key) {
        if (!(key === 'dsh.conversation' || key.indexOf('dsh.conversation.') === 0 || key === 'dsh.locale')) return false;
        return localStorage.getItem(key) === checkpoint.preferences[key];
      });
    } catch (error) {}
    window.dshDesktop._call('client-update.ui-restore-checkpoint',{nonce:checkpoint.nonce,origin:location.origin,readable:readable}).catch(function () {});
  }
  if (document.body) run();else document.addEventListener('DOMContentLoaded',run,{once:true});
})
