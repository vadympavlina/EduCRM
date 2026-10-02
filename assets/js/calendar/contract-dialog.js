// ============================================================
//  calendar/contract-dialog.js — оформлення договору до заняття
// ============================================================

import { html } from '../core/dom.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';
import { openDialog, fieldError } from '../ui/dialog.js';
import { createContract } from '../data/contracts.js';
import { teacherColor } from '../data/teachers.js';
import { store, teacherOptions } from './store.js';

/**
 * openContractDialog({ phone, clientName, teacherId, eventId, eventTitle, exists, staff })
 * → Promise<договір | null>
 */
export function openContractDialog({ phone, clientName, teacherId, eventId, eventTitle, exists = false, staff, clientKey = null }) {
  return new Promise(resolve => {
    let created = null;
    openDialog({
      title: 'Оформити договір',
      subtitle: [clientName, eventTitle].filter(Boolean).join(' · '),
      width: 460,
      submitText: 'Оформити',
      content: html`
        ${exists ? html`<div class="alert alert-warning">${icon('alert-triangle', 16)}<span>На це заняття договір уже оформлено. Буде створено ще один.</span></div>` : ''}
        ${teacherId ? '' : html`
          <label class="field"><span class="field-label">Вчитель, якому нараховується бонус</span>
            <select class="select" name="cTeacher">
              <option value="" data-placeholder>— Оберіть вчителя —</option>
              ${teacherOptions().map(t => html`<option value="${t.id}" data-color="${teacherColor(store.teachers, t.id)}">${t.name}</option>`)}
            </select></label>`}
        <label class="field"><span class="field-label">Назва договору</span>
          <input class="input" name="cTitle" value="Договір — ${clientName || ''}" maxlength="120" autofocus></label>
        <label class="checkbox"><input type="checkbox" name="cAlready">
          <span>Клієнт уже мав договір раніше — бонус вчителю не нараховується</span></label>
        <p class="field-hint">Дата підписання — сьогодні. Оформлює: ${staff?.name || ''}</p>`,
      async onSubmit(form) {
        const title = form.elements.cTitle.value.trim();
        if (!title) return fieldError(form.elements.cTitle);
        const teacher = teacherId || form.elements.cTeacher?.value;
        if (!teacher) { toast('Оберіть вчителя', 'warning'); return fieldError(form.elements.cTeacher); }
        created = await createContract(phone, {
          title, clientName, teacherId: teacher, eventId, eventTitle, clientKey, alreadyHad: form.elements.cAlready.checked,
        }, staff);
        toast('Договір оформлено', 'success');
      },
      onClose: () => resolve(created),
    });
  });
}
