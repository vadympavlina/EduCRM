// ============================================================
//  ui/dialog.js — модальні вікна на нативному <dialog>
//  (Esc, фокус і блокування фону — силами браузера).
// ============================================================

import { html, render, busy } from '../core/dom.js';
import { icon } from './icons.js';
import { toast } from './toast.js';

/**
 * openDialog({
 *   title, subtitle, content,            // content — html``
 *   submitText, cancelText, danger,
 *   width,                               // px, за замовчуванням 480
 *   extraFooter,                         // html`` ліворуч у футері
 *   onSubmit: async (form, dialog) => …  // false — не закривати
 *   onOpen:   (form, dialog) => …
 * })
 */
export function openDialog({
  title, subtitle = '', content, submitText = 'Зберегти', cancelText = 'Скасувати',
  danger = false, width = 480, extraFooter = '', hideCancel = false, hideSubmit = false,
  onSubmit, onOpen, onClose,
}) {
  const dlg = document.createElement('dialog');
  dlg.className = 'dialog';
  dlg.style.setProperty('--dw', width + 'px');

  render(dlg, html`
    <form class="dialog-form" novalidate>
      <header class="dialog-header">
        <div style="flex:1;min-width:0">
          <h2>${title}</h2>
          ${subtitle ? html`<p>${subtitle}</p>` : ''}
        </div>
        <button type="button" class="icon-btn" data-dialog-close aria-label="Закрити">${icon('x')}</button>
      </header>
      <div class="dialog-body">${content}</div>
      <footer class="dialog-footer">
        ${extraFooter}
        <span class="spacer"></span>
        ${hideCancel ? '' : html`<button type="button" class="btn" data-dialog-close>${cancelText}</button>`}
        ${hideSubmit ? '' : html`<button type="submit" class="btn ${danger ? 'btn-danger' : 'btn-primary'}">${submitText}</button>`}
      </footer>
    </form>`);

  const form = dlg.querySelector('form');
  const submitBtn = form.querySelector('[type="submit"]');

  dlg.querySelectorAll('[data-dialog-close]').forEach(b => b.addEventListener('click', () => dlg.close('cancel')));
  // Клік по затемненню (поза вікном) закриває діалог
  dlg.addEventListener('mousedown', e => { if (e.target === dlg) dlg.close('cancel'); });
  dlg.addEventListener('close', () => { onClose?.(dlg.returnValue); dlg.remove(); });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!onSubmit) return dlg.close('ok');
    await busy(submitBtn, async () => {
      try {
        const result = await onSubmit(form, dlg);
        if (result !== false) dlg.close('ok');
      } catch (err) {
        console.error(err);
        toast('Не вдалося зберегти. Спробуйте ще раз.', 'error');
      }
    });
  });

  document.body.append(dlg);
  dlg.showModal();
  onOpen?.(form, dlg);
  // Фокус на першому полі з autofocus, інакше — на тілі вікна (а не на кнопці «Закрити»)
  const first = form.querySelector('[autofocus]');
  if (first) first.focus();
  else { const body = form.querySelector('.dialog-body'); body.tabIndex = -1; body.focus({ preventScroll: true }); }
  return dlg;
}

/** Підтвердження дії. Повертає Promise<boolean>. */
export function confirmDialog({ title, message = '', confirmText = 'Підтвердити', danger = false }) {
  return new Promise(resolve => {
    let confirmed = false;
    openDialog({
      title,
      width: 420,
      submitText: confirmText,
      danger,
      content: html`
        <div style="display:flex;gap:14px;align-items:flex-start">
          <div class="dialog-icon ${danger ? 'danger' : ''}">${icon(danger ? 'alert-triangle' : 'info', 20)}</div>
          <p style="color:var(--text-2);padding-top:8px">${message}</p>
        </div>`,
      onSubmit: () => { confirmed = true; },
      onClose: () => resolve(confirmed),
    });
  });
}

/** Позначає поле як помилкове і ставить на нього фокус. */
export function fieldError(input) {
  input.setAttribute('aria-invalid', 'true');
  input.focus();
  input.addEventListener('input', () => input.removeAttribute('aria-invalid'), { once: true });
  return false;
}
