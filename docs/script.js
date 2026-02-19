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

const state = loadState() ?? createInitialState();
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
  renderEventOptions();
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

let draggedSlotId = null;

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
      const activeEvent = getActiveEvent();
      if (!activeEvent) return;
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

function getActiveEvent() {
  return state.events.find((event) => event.id === state.activeEventId) ?? null;
}

function loadState() {
  try {
    const payload = window.localStorage.getItem(STORAGE_KEY);
    if (!payload) return null;
    const parsed = JSON.parse(payload);
    if (!parsed || !Array.isArray(parsed.events)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveState() {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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
