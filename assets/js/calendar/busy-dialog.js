// ============================================================
//  calendar/busy-dialog.js — разове блокування («зайнятий час»)
//  busySlots/{id} = { title, date, startTime, endTime, teacherId, createdBy, createdAt }
// ============================================================

import { db, ref, push, set, update, remove } from '../core/firebase.js';
import { html, on } from '../core/dom.js';
import { isoDate, pad } from '../core/format.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';
import { openDialog, confirmDialog, fieldError } from '../ui/dialog.js';
import { teacherColor } from '../data/teachers.js';
import { toMin } from '../data/events.js';
import { store, teacherName, teacherOptions } from './store.js';

const hhmm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** openBusyDialog({ id }) — редагування; openBusyDialog({ start, end }) — нове. */
export function openBusyDialog({ id = null, start = null, end = null } = {}) {
  const b = id ? store.busySlots[id] : null;
  if (id && !b) { toast('Блокування не знайдено', 'warning'); return; }
  const s = start || new Date(new Date().setHours(10, 0, 0, 0));
  const e = end || new Date(s.getTime() + 3600e3);
  const v = b || { title: '', date: isoDate(s), startTime: hhmm(s), endTime: hhmm(e), teacherId: '' };

  const dlg = openDialog({
    title: b ? 'Разове блокування' : 'Зайнятий час',
    subtitle: 'У цей час не можна записати заняття',
    width: 480,
    submitText: b ? 'Зберегти' : 'Заблокувати',
    extraFooter: b ? html`<button type="button" class="btn btn-ghost" data-action="delete" style="color:var(--danger)">${icon('trash', 15)} Видалити</button>` : '',
    content: html`
      <label class="field"><span class="field-label">Причина</span>
        <input class="input" name="bTitle" maxlength="60" value="${v.title || ''}" placeholder="напр. Нарада, обід" ${b ? '' : 'autofocus'}></label>
      <div class="field-row-3">
        <label class="field"><span class="field-label">Дата</span><input class="input" type="date" name="bDate" value="${v.date}"></label>
        <label class="field"><span class="field-label">Початок</span><input class="input" type="time" name="bStart" value="${v.startTime}"></label>
        <label class="field"><span class="field-label">Кінець</span><input class="input" type="time" name="bEnd" value="${v.endTime}"></label>
      </div>
      <label class="field"><span class="field-label">Для кого</span>
        <select class="select" name="bTeacher">
          <option value="">Для всіх</option>
          ${teacherOptions(v.teacherId).map(t => html`<option value="${t.id}" data-color="${teacherColor(store.teachers, t.id)}" ${t.id === v.teacherId ? 'selected' : ''}>${t.name}</option>`)}
        </select></label>`,
    onOpen(form) {
      on(form, 'click', '[data-action="delete"]', async () => {
        const ok = await confirmDialog({
          title: 'Зняти блокування?',
          message: `«${b.title || 'Зайнято'}» ${b.date} ${b.startTime}–${b.endTime}${b.teacherId ? ` (${teacherName(b.teacherId)})` : ''} буде видалено.`,
          confirmText: 'Зняти', danger: true,
        });
        if (!ok) return;
        await remove(ref(db, 'busySlots/' + id))
          .then(() => { toast('Блокування знято', 'success'); dlg.close('ok'); })
          .catch(() => toast('Не вдалося видалити', 'error'));
      });
    },
    async onSubmit(form) {
      const f = form.elements;
      if (!f.bDate.value) return fieldError(f.bDate);
      if (!f.bStart.value) return fieldError(f.bStart);
      if (!f.bEnd.value || toMin(f.bEnd.value) <= toMin(f.bStart.value)) { toast('Кінець має бути пізніше за початок', 'warning'); return fieldError(f.bEnd); }
      const data = {
        title: f.bTitle.value.trim() || 'Зайнято',
        date: f.bDate.value, startTime: f.bStart.value, endTime: f.bEnd.value,
        teacherId: f.bTeacher.value || '',
      };
      if (b) await update(ref(db, 'busySlots/' + id), data);
      else await set(push(ref(db, 'busySlots')), { ...data, createdBy: store.staff.name, createdAt: Date.now() });
      toast(b ? 'Зміни збережено' : 'Час заблоковано', 'success');
    },
  });
  return dlg;
}
