import { getState, update, resolveImage } from '../store.js';
import { esc, $, $$, toast, mountDrop, dropHTML, enter } from './ui.js';

let draft = null;
let base = null;
const dirty = () => JSON.stringify(draft) !== JSON.stringify(base);

export function renderContent(root, fresh = true) {
  const pub = getState().content;
  if (fresh || !draft) {
    base = structuredClone(pub);
    draft = structuredClone(pub);
  }
  const a = draft.announcement;
  const h = draft.hero;
  root.innerHTML = `
    <header class="page-head"><div><h1>Editorial</h1>
      <p>The words and pictures at the front of the store. Changes stay in draft until you publish them.</p></div>
      <div class="page-head__actions"><a class="btn btn--ghost" href="../" target="_blank" rel="noopener">Open storefront</a></div></header>

    <section class="block" aria-labelledby="b1">
      <div class="block__intro"><h2 id="b1">Announcement</h2><p>A slim bar above the navigation for shipping notes, launches or offers.</p></div>
      <div class="block__form">
        <label class="switch"><input type="checkbox" data-a="enabled" ${a.enabled ? 'checked' : ''}><i></i>Show the announcement bar</label>
        <div class="field"><label for="a-text">Message</label><input id="a-text" class="input" data-a="text" maxlength="140" value="${esc(a.text)}" /><small data-count="a-text"></small></div>
        <div class="row2">
          <div class="field"><label for="a-l">Link label</label><input id="a-l" class="input" data-a="linkLabel" value="${esc(a.linkLabel)}" /></div>
          <div class="field"><label for="a-h">Link to</label><input id="a-h" class="input" data-a="linkHref" value="${esc(a.linkHref)}" /><small>For example #shop or #collections</small></div>
        </div>
        <div><p class="label" style="font-weight:500;margin-bottom:8px">Preview</p>
          <div class="bar-preview ${a.enabled ? '' : 'is-off'}" data-prev><span data-prev-t>${esc(a.text)}</span>${a.linkLabel ? `<a href="#" data-prev-l onclick="return false">${esc(a.linkLabel)}</a>` : '<a data-prev-l hidden></a>'}</div></div>
      </div>
    </section>

    <section class="block" aria-labelledby="b2">
      <div class="block__intro"><h2 id="b2">Hero</h2><p>The headline and the three photographs that rotate behind it on the home page.</p></div>
      <div class="block__form">
        <div class="field"><label for="h-h">Headline</label><input id="h-h" class="input" data-h="headline" maxlength="60" value="${esc(h.headline)}" /></div>
        <div class="field"><label for="h-s">Supporting line</label><textarea id="h-s" class="textarea" style="min-height:84px" data-h="sub" maxlength="200">${esc(h.sub)}</textarea></div>
        <div class="field"><label for="h-c">Button label</label><input id="h-c" class="input" data-h="cta" maxlength="32" value="${esc(h.cta)}" /></div>
        <div>${h.slides
          .map(
            (sl, i) => `<div class="item-row item-row--wide" data-slide="${i}">${dropHTML('Add photo')}
          <div class="item-fields"><div class="field"><label for="sl-${i}">Slide ${i + 1} caption</label><input id="sl-${i}" class="input" data-cap value="${esc(sl.caption)}" maxlength="80" /></div>
          <span class="err" data-err role="alert"></span></div></div>`,
          )
          .join('')}</div>
      </div>
    </section>

    <section class="block" aria-labelledby="b3">
      <div class="block__intro"><h2 id="b3">Featured collections</h2><p>The three collection highlights below the hero. Hide one to remove it from the page.</p></div>
      <div class="block__form">${draft.collections
        .map(
          (c, i) => `<div class="item-row" data-col="${i}">${dropHTML('Add photo')}
        <div class="item-fields">
          <div class="field"><label for="c-t-${i}">Title</label><input id="c-t-${i}" class="input" data-ct value="${esc(c.title)}" maxlength="40" /></div>
          <div class="field"><label for="c-d-${i}">Description</label><textarea id="c-d-${i}" class="textarea" style="min-height:84px" data-cd maxlength="220">${esc(c.description)}</textarea></div>
          <label class="switch"><input type="checkbox" data-cv ${c.visible ? 'checked' : ''}><i></i>Visible on the page</label>
          <span class="err" data-err role="alert"></span></div></div>`,
        )
        .join('')}</div>
    </section>

    <div class="publishbar"><p data-state></p>
      <div class="publishbar__actions"><button class="btn btn--ghost" data-discard>Discard changes</button><button class="btn btn--accent" data-publish>Publish</button></div></div>`;
  enter(root);

  const bar = () => {
    const d = dirty();
    $('[data-state]', root).className = d ? 'is-dirty' : 'is-live';
    $('[data-state]', root).innerHTML = d
      ? '<span class="dot"></span>Unpublished changes'
      : `<span class="dot"></span>${pub.publishedAt ? `Live. Published ${new Date(pub.publishedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}` : 'Live, with the original content'}`;
    $('[data-publish]', root).disabled = !d;
    $('[data-discard]', root).disabled = !d;
  };
  const count = () => {
    const el = $('[data-count=a-text]', root);
    el.textContent = `${draft.announcement.text.length} of 140 characters`;
  };
  bar();
  count();

  root.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.a) {
      draft.announcement[t.dataset.a] = t.type === 'checkbox' ? t.checked : t.value;
      $('[data-prev]', root).classList.toggle('is-off', !draft.announcement.enabled);
      $('[data-prev-t]', root).textContent = draft.announcement.text;
      const l = $('[data-prev-l]', root);
      l.textContent = draft.announcement.linkLabel;
      l.hidden = !draft.announcement.linkLabel;
      count();
    } else if (t.dataset.h) draft.hero[t.dataset.h] = t.value;
    else if (t.matches('[data-cap]')) draft.hero.slides[t.closest('[data-slide]').dataset.slide].caption = t.value;
    else if (t.matches('[data-ct]')) draft.collections[t.closest('[data-col]').dataset.col].title = t.value;
    else if (t.matches('[data-cd]')) draft.collections[t.closest('[data-col]').dataset.col].description = t.value;
    else if (t.matches('[data-cv]')) draft.collections[t.closest('[data-col]').dataset.col].visible = t.checked;
    bar();
  });

  const err = (row) => (m) => ($('[data-err]', row).textContent = m);
  $$('[data-slide]', root).forEach((row) => {
    const i = Number(row.dataset.slide);
    mountDrop($('.drop', row), {
      src: resolveImage(draft.hero.slides[i].image),
      max: 2000,
      onChange: (d) => ((draft.hero.slides[i].image = d), bar()),
      onError: err(row),
    });
  });
  $$('[data-col]', root).forEach((row) => {
    const i = Number(row.dataset.col);
    mountDrop($('.drop', row), {
      src: resolveImage(draft.collections[i].image),
      max: 1400,
      onChange: (d) => ((draft.collections[i].image = d), bar()),
      onError: err(row),
    });
  });

  $('[data-discard]', root).addEventListener('click', () => {
    renderContent(root, true);
    toast('Changes discarded');
  });
  $('[data-publish]', root).addEventListener('click', () => {
    if (!draft.hero.headline.trim()) {
      $('#h-h', root).focus();
      return toast('The hero needs a headline before it can go live.');
    }
    try {
      update((s) => {
        s.content = { ...structuredClone(draft), publishedAt: Date.now() };
      });
      toast('Published. Reload the storefront to see it.');
      renderContent(root, true);
    } catch (e) {
      toast(e.message === 'storage-full' ? 'Browser storage is full. Use smaller photos, or discard an upload.' : 'Could not publish.');
    }
  });
}
