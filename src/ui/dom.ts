/** Tiny DOM helpers shared by every UI feature (no framework). */

type Child = Node | string | number | null | undefined | false;
type Attrs = Readonly<Record<string, string | number | boolean | null | undefined>>;

/** Creates an element. `class`, `aria-*`, `data-*` etc. are attributes; true = empty attribute; null/false/undefined = omitted. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    el.setAttribute(name, value === true ? '' : String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(typeof child === 'number' ? String(child) : child);
  }
  return el;
}

/** Appends `child` to `parent`; returns the remover (pass it to ctx.addDisposer). */
export function mount(parent: Element, child: Element): () => void {
  parent.append(child);
  return () => child.remove();
}
