import { h, mount } from '../ui/dom';

/** STUB — owner: plan 06-04 (phone remote: host panel / vote panel). */
const root = document.getElementById('remote');
if (root) mount(root, h('p', { class: 'sl-label', style: 'padding: var(--margin); color: var(--text-2)' }, 'Remote coming soon'));
