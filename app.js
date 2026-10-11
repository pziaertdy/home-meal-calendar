/*
 * 家常日历 · 一个纯前端 PWA。所有菜单更动只写本机 localStorage。
 * 禁止将备份内容作为 HTML 运行；导入只接受 26 个已知菜名的互异 ID 排列。
 */
(() => {
  'use strict';
  const START = '2026-10-12';
  const STORAGE_KEY = 'guangdong-family-meal-calendar-v1';
  const BACKUP_FORMAT = 'guangdong-family-meal-calendar';
  const WEEKDAY = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  const MEALS = Object.freeze([
    { name: '西红柿鸡蛋', category: '蛋类' }, { name: '蒸排骨', category: '猪肉' },
    { name: '莴笋炒肉', category: '猪肉' }, { name: '手撕鸡', category: '鸡肉' },
    { name: '鸡蛋炒韭菜', category: '蛋类' }, { name: '牛腩炖萝卜', category: '牛肉' },
    { name: '酸笋炒肉', category: '猪肉' }, { name: '烧鸭', category: '鸭肉' },
    { name: '火腿', category: '加工肉' }, { name: '花甲', category: '海鲜' },
    { name: '蒸水蛋', category: '蛋类' }, { name: '叉烧', category: '猪肉' },
    { name: '豆腐', category: '豆制品' }, { name: '猪脚', category: '猪肉' },
    { name: '肉饼', category: '猪肉' }, { name: '牛仔骨', category: '牛肉' },
    { name: '馄饨', category: '主食' }, { name: '卤水鸭翅', category: '鸭肉' },
    { name: '酿豆腐', category: '豆腐／肉' }, { name: '凤爪', category: '鸡肉' },
    { name: '卤水鸡翅', category: '鸡肉' }, { name: '蛋包肉', category: '蛋／肉' },
    { name: '酸菜炒肉', category: '猪肉' }, { name: '卤水鸡腿', category: '鸡肉' },
    { name: '饺子', category: '主食' }, { name: '牛肉丸', category: '牛肉' }
  ]);
  const DEFAULT_SCHEDULE = MEALS.map((_, i) => i);
  const DAYS = Array.from({ length: 13 }, (_, i) => {
    const day = new Date(2026, 9, 12 + i); // 本地时区建日，不用 UTC ISO 字符串解析
    return {
      key: `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`,
      date: `${day.getMonth() + 1}月${day.getDate()}日`,
      weekday: WEEKDAY[day.getDay()],
      short: `${day.getMonth() + 1}.${day.getDate()}`,
      index: i
    };
  });
  const $ = id => document.getElementById(id);
  const scheduleEl = $('schedule');
  let schedule = [...DEFAULT_SCHEDULE];
  let selectedSlot = null;
  let lastSwap = null;
  let toastTimer = null;
  let lastTodayKey = '';
  let drag = null;
  let autoscrollFrame = 0;
  let swReady = false;
  let readOnly = false;

  function validateSchedule(s) {
    return Array.isArray(s) && s.length === 26 && s.every(id => Number.isInteger(id) && id >= 0 && id < 26) && new Set(s).size === 26;
  }
  function validateBackup(x) {
    return x && typeof x === 'object' && x.format === BACKUP_FORMAT && x.schemaVersion === 1 && x.startDate === START && validateSchedule(x.schedule);
  }
  function currentDayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function todayIndex() { return DAYS.findIndex(d => d.key === currentDayKey()); }
  function ordinal(x) { return String(x).padStart(2, '0'); }
  function slotName(slot) { return (slot % 2 === 0) ? '午餐' : '晚餐'; }
  function slotWhere(slot) { return `${DAYS[Math.floor(slot / 2)].date} ${slotName(slot)}`; }
  function encode(str) { return String(str).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }

  function showStorageWarning(message) {
    const el = $('storage-warning');
    el.textContent = message; el.hidden = !message;
  }
  function loadStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!validateBackup(parsed)) throw new Error('本机排班记录格式不正确');
      schedule = [...parsed.schedule];
    } catch (error) {
      // 不覆盖无法识别的数据；允许用户手动检查或重置后再使用。
      readOnly = true;
      showStorageWarning('发现本机旧记录无法安全读取，暂时显示初始排班并停止自动覆盖。请先通过「备份与设置」检查，或确认恢复原始排班。');
    }
  }
  function saveSchedule(next) {
    if (readOnly) { showToast('本机记录待处理，暂时不能保存新交换。'); return false; }
    const payload = { format: BACKUP_FORMAT, schemaVersion: 1, startDate: START, schedule: next, savedAt: new Date().toISOString() };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      schedule = [...next];
      return true;
    } catch (error) {
      showStorageWarning('保存失败：可能是浏览器禁止本机存储或空间不足。交换未生效，请在普通 Safari 或主屏幕 App 内使用。');
      showToast('保存失败，交换未执行');
      return false;
    }
  }
  function initialLabel(today) {
    if (today === -1) {
      const key = currentDayKey();
      if (key < DAYS[0].key) {
        // 不需联网，始终使用设备本地日期。
        return { pretitle: 'COMING SOON · 即将开始', title: '第一天，准备开饭', note: `10月12日 · 星期一开始这轮13天菜单`, symbol: '✿', target: 0 };
      }
      return { pretitle: 'THE LITTLE PLAN · 本轮已结束', title: '这一轮，认真吃好了', note: '2026年10月12日至24日的菜单都保留在下方，仍可自由交换、导出备份。', symbol: '♡', target: 12 };
    }
    return { pretitle: 'TODAY’S MENU · 今日菜单', title: `${DAYS[today].date} · ${DAYS[today].weekday}`, note: `今天是第 ${today + 1} 天。想换口味？点下面两道菜交换就好。`, symbol: '☼', target: today };
  }
  function renderToday() {
    const today = todayIndex();
    const meta = initialLabel(today);
    const slot = meta.target * 2;
    $('today-panel').innerHTML = `
      <div class="today-icon" aria-hidden="true">${meta.symbol}</div>
      <div class="today-copy"><span class="today-caption">${meta.pretitle}</span><h3>${meta.title}</h3><p>${meta.note}</p></div>
      <div class="today-dishes">
        <div class="today-pill"><small>☀️ 午餐</small><strong>${encode(MEALS[schedule[slot]].name)}</strong></div>
        <div class="today-pill dinner"><small>☾ 晚餐</small><strong>${encode(MEALS[schedule[slot + 1]].name)}</strong></div>
      </div>
      <button class="today-button" type="button" id="show-today">${today < 0 ? '查看这天' : '查看今日'} ↗</button>`;
    $('show-today').addEventListener('click', () => scrollDay(meta.target));
  }
  function renderDay(dayIndex, currentIndex) {
    const day = DAYS[dayIndex];
    const isToday = dayIndex === currentIndex;
    const cardBadge = isToday ? '<span class="today-tag">● 今日</span>' : dayIndex === 0 ? '<span class="first-tag">第一天</span>' : '';
    const tile = (slot, kind, mark) => {
      const dish = MEALS[schedule[slot]];
      const isSelected = selectedSlot === slot;
      return `<button class="meal-tile ${kind}${isSelected ? ' is-selected' : ''}" type="button" data-slot="${slot}" aria-pressed="${isSelected}" aria-label="${day.date}${slotName(slot)}：${encode(dish.name)}。点选后再点另一道菜交换">
        <span class="meal-top"><span class="meal-kind">${mark} ${slotName(slot)}</span><span class="drag-handle" data-drag-handle="${slot}" aria-hidden="true" title="按住拖到另一道菜上交换">⠿</span></span>
        <span class="meal-name">${encode(dish.name)}</span><span class="meal-category">${encode(dish.category)}</span>
      </button>`;
    };
    return `<article class="day-card ${isToday ? 'is-today' : ''}" id="day-${dayIndex}" aria-label="第${dayIndex + 1}天，${day.date}${day.weekday}${isToday ? '，今日' : ''}">
      <div class="day-card-head"><div><span class="day-number">DAY ${ordinal(dayIndex + 1)}</span><span class="day-date">${day.date} <span class="day-week">${day.weekday}</span></span></div>${cardBadge}</div>
      <div class="meal-row">${tile(dayIndex * 2, 'lunch', '☀️')}${tile(dayIndex * 2 + 1, 'dinner', '☾')}</div>
    </article>`;
  }
  function renderSchedule() {
    const currentIndex = todayIndex();
    const weeks = [[0, 7], [7, 13]];
    scheduleEl.innerHTML = weeks.map(([start, end], i) => `
      <div class="week-label">第 ${i + 1} 周 <span style="font-weight:400;color:#b5a2ab">· ${DAYS[start].date} — ${DAYS[end - 1].date}</span></div>
      <div class="week-grid">${Array.from({ length: end - start }, (_, idx) => renderDay(start + idx, currentIndex)).join('')}</div>
    `).join('');
  }
  function renderSelection() {
    const panel = $('selection-bar'); panel.hidden = selectedSlot === null;
    if (selectedSlot !== null) $('selected-name').textContent = `${slotWhere(selectedSlot)} · ${MEALS[schedule[selectedSlot]].name}`;
  }
  function render() {
    renderToday(); renderSchedule(); renderSelection();
    const today = todayIndex();
    $('jump-today').innerHTML = today >= 0 ? '定位今日 <span aria-hidden="true">↗</span>' : currentDayKey() < DAYS[0].key ? '查看首日 <span aria-hidden="true">↗</span>' : '查看末日 <span aria-hidden="true">↗</span>';
    lastTodayKey = currentDayKey();
  }
  function scrollDay(index) { const el = $(`day-${index}`); if (el) el.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' }); }
  function selectSlot(slot) {
    if (drag?.active) return;
    if (selectedSlot === null) { selectedSlot = slot; renderSelection(); renderSchedule(); return; }
    if (selectedSlot === slot) { selectedSlot = null; renderSelection(); renderSchedule(); return; }
    const a = selectedSlot; selectedSlot = null;
    swapSlots(a, slot);
  }
  function swapSlots(a, b) {
    if (a === b || a < 0 || a > 25 || b < 0 || b > 25) return;
    const next = [...schedule];
    [next[a], next[b]] = [next[b], next[a]];
    if (!saveSchedule(next)) { renderSelection(); return; }
    lastSwap = [a, b];
    render();
    showToast(`已交换 ${slotWhere(a)} ↔ ${slotWhere(b)}`, true);
  }
  function showToast(message, canUndo = false) {
    const toast = $('toast'); $('toast-message').textContent = message; $('undo-button').hidden = !canUndo; toast.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, 4700);
  }
  function openSettings() { $('settings-dialog').showModal(); }
  function closeSettings() { $('settings-dialog').close(); }

  function createBackup() {
    return { format: BACKUP_FORMAT, schemaVersion: 1, startDate: START,
      description: '家常日历 · 13天菜品交换备份',
      schedule: [...schedule],
      dishNames: MEALS.map(m => m.name), // 供人读，不作为导入权威数据
      savedAt: new Date().toISOString() };
  }
  async function exportBackup() {
    const content = JSON.stringify(createBackup(), null, 2);
    const name = `家常日历备份_${currentDayKey()}.json`;
    const file = new File([content], name, { type: 'application/json' });
    if (navigator.canShare && navigator.share) {
      try {
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: '家常日历备份' });
          showToast('已打开系统分享面板，请选择「存储到文件」');
          return;
        }
      } catch (error) {
        if (error && error.name === 'AbortError') return;
      }
    }
    const url = URL.createObjectURL(file);
    const a = document.createElement('a'); a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 15000);
    showToast('备份文件已下载，请在「文件」中妥善保存');
  }
  async function importBackup(file) {
    if (!file) return;
    try {
      if (file.size > 64 * 1024) throw new Error('备份文件大小异常');
      const raw = JSON.parse(await file.text());
      if (!validateBackup(raw)) throw new Error('文件不是本 App 的有效 13 天、26 道菜备份，或者存在重复 / 缺失');
      const confirmed = window.confirm(`确认导入「${file.name}」？\n将用备份排班覆盖当前手机的排班。建议导入前先导出当前备份。`);
      if (!confirmed) return;
      if (readOnly) {
        // 显式确认的恢复允许替换无法识别的旧本机存储。
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...raw, savedAt: new Date().toISOString() })); readOnly = false; schedule = [...raw.schedule]; showStorageWarning(''); }
        catch (_) { showToast('本机存储不可写入，未恢复'); return; }
      } else if (!saveSchedule(raw.schedule)) return;
      selectedSlot = null; lastSwap = null; render(); closeSettings(); showToast('备份恢复成功 · 26 道菜已核对，无重复');
    } catch (error) { window.alert(`无法导入：${error.message || String(error)}`); }
  }
  function resetSchedule() {
    const ok = window.confirm('确定恢复 2026年10月12日至24日的原始排班吗？\n现在所有菜品的交换位置都会被重置。建议先导出一份备份。');
    if (!ok) return;
    if (readOnly) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...createBackup(), schedule: [...DEFAULT_SCHEDULE], savedAt: new Date().toISOString() }));
        readOnly = false; schedule = [...DEFAULT_SCHEDULE]; showStorageWarning('');
      } catch (_) { showToast('本机存储不可写入，未重置'); return; }
    } else if (!saveSchedule(DEFAULT_SCHEDULE)) return;
    selectedSlot = null; lastSwap = null; render(); closeSettings(); showToast('已恢复原始 13 天排班');
  }
  function bindEvents() {
    scheduleEl.addEventListener('click', event => {
      const tile = event.target.closest('.meal-tile[data-slot]');
      if (!tile || drag?.active) return;
      selectSlot(Number(tile.dataset.slot));
    });
    $('cancel-select').addEventListener('click', () => { selectedSlot = null; renderSelection(); renderSchedule(); });
    $('undo-button').addEventListener('click', () => {
      if (!lastSwap) return;
      const [a,b] = lastSwap; lastSwap = null;
      const next = [...schedule]; [next[a],next[b]] = [next[b],next[a]];
      if (saveSchedule(next)) { render(); showToast('已撤销上一次交换'); }
    });
    $('jump-today').addEventListener('click', () => { const today = todayIndex(); scrollDay(today >= 0 ? today : currentDayKey() < DAYS[0].key ? 0 : 12); });
    $('open-settings').addEventListener('click', openSettings);
    $('close-settings').addEventListener('click', closeSettings);
    $('settings-dialog').addEventListener('click', e => { if (e.target === $('settings-dialog')) closeSettings(); });
    $('export-backup').addEventListener('click', () => exportBackup().catch(() => showToast('导出失败，请重新尝试')));
    $('import-backup').addEventListener('click', () => $('import-file').click());
    $('import-file').addEventListener('change', event => { const file = event.target.files?.[0]; void importBackup(file); event.target.value = ''; });
    $('reset-schedule').addEventListener('click', resetSchedule);
    scheduleEl.addEventListener('pointerdown', onDragStart);
    window.addEventListener('pointermove', onDragMove, { passive: false });
    window.addEventListener('pointerup', onDragEnd);
    window.addEventListener('pointercancel', onDragCancel);
    document.addEventListener('visibilitychange', updateCalendarIfNeeded);
    window.addEventListener('focus', updateCalendarIfNeeded);
    window.addEventListener('online', updateConnectionInfo);
    window.addEventListener('offline', updateConnectionInfo);
    setInterval(updateCalendarIfNeeded, 60000);
  }
  function updateCalendarIfNeeded() { if (currentDayKey() !== lastTodayKey && !drag) render(); updateConnectionInfo(); }
  function updateConnectionInfo() {
    const isLocal = location.protocol === 'file:';
    $('build-note').textContent = isLocal ? '当前为本机文件预览；要安装及离线缓存，请通过 HTTPS 网址打开。' : navigator.onLine ? (swReady ? '离线功能已就绪 · 菜单交换仅保存在本机' : '已联网 · 正在准备离线缓存') : (swReady ? '当前离线 · 菜单仍可正常使用' : '当前离线 · 如页面加载成功即可继续使用');
  }
  // 移动端专用 Pointer Events 拖放。仅拖拽把手禁止触屏滚动，普通卡片仍可顺畅滚动。
  function onDragStart(event) {
    const handle = event.target.closest('.drag-handle[data-drag-handle]');
    if (!handle || event.button !== 0) return;
    drag = { pointerId: event.pointerId, source: Number(handle.dataset.dragHandle), startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, active: false, ghost: null, over: null };
    // 捕获后仍用 elementFromPoint 定位落点，兼容 iOS Safari。
    try { handle.setPointerCapture(event.pointerId); } catch (_) {}
  }
  function beginDrag() {
    if (!drag || drag.active) return;
    drag.active = true;
    selectedSlot = null; renderSelection();
    document.querySelectorAll('.meal-tile.is-selected').forEach(el => { el.classList.remove('is-selected'); el.setAttribute('aria-pressed', 'false'); });
    const ghost = document.createElement('div'); ghost.className = 'drag-ghost';
    ghost.textContent = MEALS[schedule[drag.source]].name;
    document.body.appendChild(ghost); drag.ghost = ghost;
    document.body.classList.add('is-dragging');
  }
  function hoverAt(x,y) {
    if (!drag?.active) return;
    const found = document.elementFromPoint(x,y)?.closest('.meal-tile[data-slot]');
    const target = found ? Number(found.dataset.slot) : null;
    const next = target === drag.source ? null : target;
    if (drag.over !== next) {
      document.querySelectorAll('.is-drop-target').forEach(el => el.classList.remove('is-drop-target'));
      drag.over = next;
      if (next !== null) document.querySelector(`.meal-tile[data-slot="${next}"]`)?.classList.add('is-drop-target');
    }
  }
  function drawDrag() {
    if (!drag?.active) return;
    drag.ghost.style.left = `${drag.x}px`;
    drag.ghost.style.top = `${drag.y}px`;
    hoverAt(drag.x,drag.y);
  }
  function autoScroll() {
    if (!drag?.active) { autoscrollFrame = 0; return; }
    const edge = 85;
    const { y } = drag;
    let delta = 0;
    if (y < edge) delta = -Math.max(4, (edge - y) * .29);
    else if (y > innerHeight - edge) delta = Math.max(4, (y - (innerHeight-edge)) * .29);
    if (delta) { window.scrollBy(0,delta); hoverAt(drag.x,drag.y); }
    autoscrollFrame = requestAnimationFrame(autoScroll);
  }
  function onDragMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag.x = event.clientX; drag.y = event.clientY;
    if (!drag.active && Math.hypot(drag.x-drag.startX, drag.y-drag.startY) > 10) {
      beginDrag(); autoscrollFrame = requestAnimationFrame(autoScroll);
    }
    if (drag.active) { event.preventDefault(); drawDrag(); }
  }
  function clearDrag() {
    cancelAnimationFrame(autoscrollFrame); autoscrollFrame = 0;
    document.querySelectorAll('.is-drop-target').forEach(el=>el.classList.remove('is-drop-target'));
    drag?.ghost?.remove(); document.body.classList.remove('is-dragging');
    drag = null;
  }
  function onDragEnd(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const { source, over, active } = drag;
    clearDrag();
    if (active) {
      // 指针结束后浏览器可能派发 click，短时间内拦截拖动产生的合成点击。
      ignoreClickUntil = performance.now() + 600;
      if (over !== null && over !== source) swapSlots(source, over);
    }
  }
  function onDragCancel(event) { if (drag && event.pointerId === drag.pointerId) clearDrag(); }
  let ignoreClickUntil = 0;
  scheduleEl.addEventListener('click', event => {
    if (performance.now() < ignoreClickUntil) event.stopImmediatePropagation();
  }, true);

  async function registerOffline() {
    if (!('serviceWorker' in navigator) || !(location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) { updateConnectionInfo(); return; }
    try {
      const reg = await navigator.serviceWorker.register('./service-worker.js', { scope: './' });
      swReady = Boolean(reg.active || (await navigator.serviceWorker.ready));
      updateConnectionInfo();
    } catch (error) { $('build-note').textContent = '离线缓存注册失败：需 HTTPS 托管且首次成功联网加载。'; }
  }
  loadStorage(); bindEvents(); render(); updateConnectionInfo(); void registerOffline();
  // 仅提供给可隔离运行的自动化验证；不包含任何外部通信。
  Object.defineProperty(window, '__MEAL_APP_TEST__', { value: Object.freeze({ validateSchedule, dateKeys: DAYS.map(d => d.key), getSchedule: () => [...schedule] }), configurable: false });
})();
