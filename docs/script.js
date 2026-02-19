const STORAGE_KEY = "live-timetable-state";

const eventSelect = document.getElementById("event-select");
const newEventBtn = document.getElementById("new-event-btn");
const eventStartInput = document.getElementById("event-start");
const eventStartApplyBtn = document.getElementById("event-start-apply");
const downloadCsvBtn = document.getElementById("download-csv-btn");
const addSlotForm = document.getElementById("add-slot-form");
const bandNameInput = document.getElementById("band-name");
const performanceDurationInput = document.getElementById("performance-duration");
const changeoverDurationInput = document.getElementById("changeover-duration");
const timetableList = document.getElementById("timetable-list");
const timetableItemTemplate = document.getElementById("timetable-item-template");
const menuToggleBtn = document.getElementById("menu-toggle");
const roomIdInput = document.getElementById("room-id");
const roomApplyBtn = document.getElementById("room-apply-btn");
const copyRoomUrlBtn = document.getElementById("copy-room-url-btn");
const syncStatus = document.getElementById("sync-status");

let draggedSlotId = null;
let state = createInitialState();

const syncContext = {
  enabled: false,
  roomId: resolveRoomId(),
  stateRef: null,
};

initResponsiveMenu();
initRoomControls();

state = loadState(syncContext.roomId) ?? createInitialState();
const cloudReady = initCloudSync(syncContext.roomId);
if (!cloudReady) {
  setSyncStatus("ローカル保存モード");
}

saveState();
renderEventOptions();
renderTimetable();

newEventBtn.addEventListener("click", () => {
  const name = window.prompt("ライブ名を入力してください", "未命名のライブ");
  if (!name) return;

  const event = createEvent(name.trim());
  state.events.push(event);
  state.activeEventId = event.id;
  saveState();
  renderTimetable();
});

eventSelect.addEventListener("change", (event) => {
  state.activeEventId = event.target.value;
  saveState();
  renderTimetable();
});

eventStartApplyBtn.addEventListener("click", () => {
  const activeEvent = getActiveEvent();
  if (!activeEvent) return;

  const value = eventStartInput.value;
  if (!/^\d{2}:\d{2}$/.test(value)) {
    window.alert("開始時刻を hh:mm 形式で入力してください。");
    return;
  }

  activeEvent.startTime = value;
  saveState();
  renderTimetable();
});

addSlotForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const activeEvent = getActiveEvent();
  if (!activeEvent) return;

  const bandName = bandNameInput.value.trim();
  const performance = Number.parseInt(performanceDurationInput.value, 10);
  const changeover = Number.parseInt(changeoverDurationInput.value, 10);

  if (!bandName || !Number.isFinite(performance) || performance <= 0) {
    window.alert("バンド名と演奏時間を正しく入力してください。");
    return;
  }

  activeEvent.slots.push({
    id: safeId(),
    bandName,
    performanceMinutes: performance,
    changeoverMinutes: Number.isFinite(changeover) && changeover >= 0 ? changeover : 0,
  });

  saveState();
  renderTimetable();
  addSlotForm.reset();
  changeoverDurationInput.value = "10";
});

downloadCsvBtn.addEventListener("click", () => {
  exportActiveEventAsCsv();
});

function initResponsiveMenu() {
  if (!menuToggleBtn) return;

  menuToggleBtn.addEventListener("click", () => {
    setMenuOpen(!document.body.classList.contains("menu-open"));
  });

  const syncLayoutMode = () => {
    const compactMode = window.innerWidth <= 1100 || !isWindowMaximized();
    document.body.classList.toggle("compact-mode", compactMode);
    if (!compactMode) {
      setMenuOpen(false);
    }
  };

  syncLayoutMode();
  window.addEventListener("resize", syncLayoutMode);
  window.addEventListener("orientationchange", syncLayoutMode);
}

function initRoomControls() {
  if (roomIdInput) {
    roomIdInput.value = syncContext.roomId;
  }

  roomApplyBtn?.addEventListener("click", () => {
    const nextRoom = sanitizeRoomId(roomIdInput?.value || "");
    if (!nextRoom) {
      window.alert("ルーム名は英数字・ハイフン・アンダースコアで入力してください。");
      return;
    }

    const params = new URLSearchParams(window.location.search);
    params.set("room", nextRoom);
    window.location.search = params.toString();
  });

  copyRoomUrlBtn?.addEventListener("click", async () => {
    const url = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(syncContext.roomId)}`;
    try {
      await navigator.clipboard.writeText(url);
      setSyncStatus("招待URLをコピーしました");
    } catch {
      window.prompt("このURLをコピーしてください", url);
    }
  });
}

function initCloudSync(roomId) {
  const config = window.FIREBASE_CONFIG;
  const validConfig = config && config.apiKey && !String(config.apiKey).startsWith("YOUR_");
  const firebaseReady = typeof window.firebase !== "undefined";

  if (!firebaseReady || !validConfig) {
    return false;
  }

  try {
    const app = window.firebase.apps.length
      ? window.firebase.app()
      : window.firebase.initializeApp(config);
    const database = app.database();
    const stateRef = database.ref(`rooms/${roomId}/state`);

    syncContext.enabled = true;
    syncContext.roomId = roomId;
    syncContext.stateRef = stateRef;

    stateRef.on("value", (snapshot) => {
      const remote = snapshot.val();
      if (!remote || !Array.isArray(remote.events)) {
        saveState();
        return;
      }

      state = normalizeState(remote);
      renderEventOptions();
      renderTimetable();
      window.localStorage.setItem(getStorageKey(roomId), JSON.stringify(state));
    });

    setSyncStatus(`リアルタイム共有中: ${roomId}`);
    return true;
  } catch {
    setSyncStatus("リアルタイム接続エラー");
    return false;
  }
}

function setMenuOpen(isOpen) {
  document.body.classList.toggle("menu-open", isOpen);
  if (menuToggleBtn) {
    menuToggleBtn.setAttribute("aria-expanded", String(isOpen));
  }
}

function isWindowMaximized() {
  const widthGap = Math.abs(window.outerWidth - window.screen.availWidth);
  const heightGap = Math.abs(window.outerHeight - window.screen.availHeight);
  return widthGap <= 24 && heightGap <= 24;
}

function setSyncStatus(message) {
  if (syncStatus) {
    syncStatus.textContent = message;
  }
}

function resolveRoomId() {
  const params = new URLSearchParams(window.location.search);
  const room = sanitizeRoomId(params.get("room") || "");
  return room || "default-room";
}

function sanitizeRoomId(value) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /^[A-Za-z0-9_-]{1,40}$/.test(trimmed) ? trimmed : "";
}

function getStorageKey(roomId) {
  return `${STORAGE_KEY}:${roomId}`;
}

function renderEventOptions() {
  eventSelect.innerHTML = "";
  state.events.forEach((event) => {
    const option = document.createElement("option");
    option.value = event.id;
    option.textContent = event.name;
    if (event.id === state.activeEventId) {
      option.selected = true;
    }
    eventSelect.append(option);
  });

  const activeEvent = getActiveEvent();
  if (activeEvent) {
    eventStartInput.value = activeEvent.startTime ?? "18:00";
  }
}

function renderTimetable() {
  const activeEvent = getActiveEvent();
  timetableList.innerHTML = "";
  if (!activeEvent) return;

  if (!activeEvent.slots.length) {
    const placeholder = document.createElement("p");
    placeholder.textContent = "演目がありません。フォームから追加してください。";
    placeholder.className = "empty-placeholder";
    timetableList.append(placeholder);
    return;
  }

  let currentMinutes = timeStringToMinutes(activeEvent.startTime);

  activeEvent.slots.forEach((slot, index) => {
    const instance = timetableItemTemplate.content.cloneNode(true);
    const item = instance.querySelector(".timetable-item");
    const bandTitle = instance.querySelector(".band-name");
    const timeRange = instance.querySelector(".time-range");
    const meta = instance.querySelector(".meta");
    const deleteButton = instance.querySelector(".delete-btn");
    const editButton = instance.querySelector(".edit-btn");

    const appliedChangeover = index === 0 ? 0 : slot.changeoverMinutes;
    const performanceStartMinutes = currentMinutes + appliedChangeover;
    const performanceEndMinutes = performanceStartMinutes + slot.performanceMinutes;
    currentMinutes = performanceEndMinutes;

    bandTitle.textContent = slot.bandName;
    timeRange.textContent = `${minutesToTimeString(performanceStartMinutes)} - ${minutesToTimeString(performanceEndMinutes)}`;
    meta.textContent = buildMetaText(slot, appliedChangeover);

    item.dataset.slotId = slot.id;

    deleteButton.addEventListener("click", () => {
      activeEvent.slots = activeEvent.slots.filter((entry) => entry.id !== slot.id);
      saveState();
      renderTimetable();
    });

    editButton.addEventListener("click", () => {
      editSlot(slot.id);
    });

    item.addEventListener("dragstart", () => {
      draggedSlotId = slot.id;
      item.classList.add("dragging");
    });

    item.addEventListener("dragend", () => {
      draggedSlotId = null;
      item.classList.remove("dragging");
      timetableList.querySelectorAll(".drop-target").forEach((el) => {
        el.classList.remove("drop-target");
      });
    });

    item.addEventListener("dragover", (event) => {
      event.preventDefault();
      if (item.dataset.slotId === draggedSlotId) return;
      timetableList.querySelectorAll(".drop-target").forEach((el) => {
        el.classList.remove("drop-target");
      });
      item.classList.add("drop-target");
    });

    item.addEventListener("dragleave", () => {
      item.classList.remove("drop-target");
    });

    item.addEventListener("drop", (event) => {
      event.preventDefault();
      item.classList.remove("drop-target");
      if (!draggedSlotId || draggedSlotId === slot.id) return;
      reorderSlots(draggedSlotId, slot.id);
    });

    timetableList.append(instance);
  });

  timetableList.addEventListener(
    "dragover",
    (event) => {
      if (!draggedSlotId) return;
      event.preventDefault();
    },
    { once: true }
  );

  timetableList.addEventListener(
    "drop",
    (event) => {
      if (!draggedSlotId) return;
      event.preventDefault();
      const currentEvent = getActiveEvent();
      if (!currentEvent) return;
      const targetId = event.target.closest(".timetable-item")?.dataset.slotId;
      if (!targetId) {
        moveSlotToEnd(draggedSlotId);
      }
    },
    { once: true }
  );
}

function reorderSlots(sourceId, targetId) {
  const activeEvent = getActiveEvent();
  if (!activeEvent) return;

  const sourceIndex = activeEvent.slots.findIndex((slot) => slot.id === sourceId);
  const targetIndex = activeEvent.slots.findIndex((slot) => slot.id === targetId);
  if (sourceIndex === -1 || targetIndex === -1) return;

  const [moved] = activeEvent.slots.splice(sourceIndex, 1);
  activeEvent.slots.splice(targetIndex, 0, moved);
  saveState();
  renderTimetable();
}

function moveSlotToEnd(slotId) {
  const activeEvent = getActiveEvent();
  if (!activeEvent) return;

  const index = activeEvent.slots.findIndex((slot) => slot.id === slotId);
  if (index === -1) return;

  const [moved] = activeEvent.slots.splice(index, 1);
  activeEvent.slots.push(moved);
  saveState();
  renderTimetable();
}

function editSlot(slotId) {
  const activeEvent = getActiveEvent();
  if (!activeEvent) return;

  const slot = activeEvent.slots.find((entry) => entry.id === slotId);
  if (!slot) return;

  const nameInput = window.prompt("バンド名を入力してください", slot.bandName);
  if (nameInput === null) return;

  const trimmedName = nameInput.trim();
  if (!trimmedName) {
    window.alert("バンド名は必須です。");
    return;
  }

  const performanceInput = window.prompt(
    "演奏時間 (分) を入力してください",
    String(slot.performanceMinutes)
  );
  if (performanceInput === null) return;

  const performanceMinutes = Number.parseInt(performanceInput, 10);
  if (!Number.isFinite(performanceMinutes) || performanceMinutes <= 0) {
    window.alert("演奏時間は1分以上の整数で入力してください。");
    return;
  }

  const changeoverInput = window.prompt(
    "転換時間 (分) を入力してください",
    String(slot.changeoverMinutes)
  );
  if (changeoverInput === null) return;

  const changeoverMinutes = Number.parseInt(changeoverInput, 10);
  if (!Number.isFinite(changeoverMinutes) || changeoverMinutes < 0) {
    window.alert("転換時間は0分以上の整数で入力してください。");
    return;
  }

  slot.bandName = trimmedName;
  slot.performanceMinutes = performanceMinutes;
  slot.changeoverMinutes = changeoverMinutes;
  saveState();
  renderTimetable();
}

function createEvent(name) {
  return {
    id: safeId(),
    name,
    startTime: "18:00",
    slots: [],
  };
}

function createInitialState() {
  const initial = {
    events: [createEvent("サンプルライブ")],
    activeEventId: "",
  };
  initial.activeEventId = initial.events[0].id;
  return initial;
}

function normalizeState(parsed) {
  if (!parsed || !Array.isArray(parsed.events) || parsed.events.length === 0) {
    return createInitialState();
  }

  const events = parsed.events
    .map((event) => ({
      id: String(event?.id || safeId()),
      name: String(event?.name || "未命名のライブ"),
      startTime: /^\d{2}:\d{2}$/.test(String(event?.startTime || ""))
        ? String(event.startTime)
        : "18:00",
      slots: Array.isArray(event?.slots)
        ? event.slots.map((slot) => ({
            id: String(slot?.id || safeId()),
            bandName: String(slot?.bandName || "未設定"),
            performanceMinutes: normalizePositiveInt(slot?.performanceMinutes, 1),
            changeoverMinutes: normalizeNonNegativeInt(slot?.changeoverMinutes, 0),
          }))
        : [],
    }))
    .filter((event) => event.id);

  if (!events.length) {
    return createInitialState();
  }

  const activeExists = events.some((event) => event.id === parsed.activeEventId);
  return {
    events,
    activeEventId: activeExists ? parsed.activeEventId : events[0].id,
  };
}

function normalizePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeNonNegativeInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function getActiveEvent() {
  return state.events.find((event) => event.id === state.activeEventId) ?? null;
}

function loadState(roomId) {
  try {
    const payload = window.localStorage.getItem(getStorageKey(roomId));
    if (!payload) return null;
    return normalizeState(JSON.parse(payload));
  } catch {
    return null;
  }
}

function saveState() {
  const normalized = normalizeState(state);
  state = normalized;

  const payload = JSON.stringify(normalized);
  window.localStorage.setItem(getStorageKey(syncContext.roomId), payload);

  if (syncContext.enabled && syncContext.stateRef) {
    syncContext.stateRef.set(normalized).catch(() => {
      setSyncStatus("クラウド保存に失敗しました");
    });
  }

  renderEventOptions();
}

function timeStringToMinutes(timeString) {
  const [hours, minutes] = timeString.split(":").map(Number);
  return hours * 60 + minutes;
}

function minutesToTimeString(totalMinutes) {
  const normalized = ((totalMinutes % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60)
    .toString()
    .padStart(2, "0");
  const minutes = (normalized % 60).toString().padStart(2, "0");
  return `${hours}:${minutes}`;
}

function safeId() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `slot-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function buildMetaText(slot, appliedChangeover) {
  return `転換 ${appliedChangeover}分 / 演奏 ${slot.performanceMinutes}分`;
}

function exportActiveEventAsCsv() {
  const activeEvent = getActiveEvent();
  if (!activeEvent) {
    window.alert("エクスポートするライブが見つかりません。");
    return;
  }

  if (!activeEvent.slots.length) {
    window.alert("演目がないためCSVを作成できません。");
    return;
  }

  let currentMinutes = timeStringToMinutes(activeEvent.startTime);
  const rows = activeEvent.slots.map((slot, index) => {
    const appliedChangeover = index === 0 ? 0 : slot.changeoverMinutes;
    const performanceStartMinutes = currentMinutes + appliedChangeover;
    const performanceEndMinutes = performanceStartMinutes + slot.performanceMinutes;
    const timeRangeText = `${minutesToTimeString(performanceStartMinutes)}~${minutesToTimeString(performanceEndMinutes)}`;
    const row = [timeRangeText, slot.bandName];
    currentMinutes = performanceEndMinutes;
    return row;
  });

  const header = ["演奏時間", "バンド名"];
  const csvContent = buildCsv([header, ...rows]);
  triggerCsvDownload(csvContent, activeEvent.name);
}

function buildCsv(rows) {
  return rows
    .map((columns) => columns.map(escapeCsvField).join(","))
    .join("\r\n");
}

function escapeCsvField(value) {
  const needsQuotes = /[",\r\n]/.test(value);
  if (!needsQuotes) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

function triggerCsvDownload(csvContent, eventName) {
  const blob = new Blob([`\ufeff${csvContent}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${sanitizeFileName(eventName || "timetable")}.csv`;
  document.body.append(link);
  link.click();
  requestAnimationFrame(() => {
    link.remove();
    URL.revokeObjectURL(url);
  });
}

function sanitizeFileName(name) {
  return name.replace(/[\\/:*?"<>|]/g, "_");
}
