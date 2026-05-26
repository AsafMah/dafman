// ComposerSubmitButton — SplitButton-style submit affordance that
// reads the active Lexical editor's text + attachments and emits a
// ComposerSubmitPayload. Extracted from MessageComposer.vue
// (Phase D.4.4).
//
// Lives under `lexical-vue/LexicalComposer` so `useLexicalComposer()`
// resolves to the active editor; emitting the payload up to the
// parent SFC keeps the actual submit-routing logic (mode resolution,
// session targeting) where it belongs.

import { defineComponent, h, type PropType } from 'vue';
import SplitButton from 'primevue/splitbutton';
import type { MenuItem } from 'primevue/menuitem';
import { useLexicalComposer } from 'lexical-vue/LexicalComposer';

import {
  consumeComposerText,
  type ComposerSubmitPayload,
} from '@/lexical/plugins';

export default defineComponent({
  name: 'ComposerSubmitButton',
  props: {
    disabled: { type: Boolean, default: false },
    label: { type: String, required: true },
    icon: { type: String, required: true },
    tooltip: { type: String, required: true },
    model: { type: Array as PropType<MenuItem[]>, required: true },
  },
  emits: ['submit'],
  setup(props, { emit }) {
    const editor = useLexicalComposer();

    function fire(): void {
      if (props.disabled) return;

      const result = consumeComposerText(editor);

      if (result !== null) {
        const payload: ComposerSubmitPayload = {
          text: result.text,
          mode: 'default',
          ...(result.attachments.length > 0 ? { attachments: result.attachments } : {}),
        };

        emit('submit', payload);
      }
    }

    return () =>
      h(SplitButton, {
        label: props.label,
        icon: props.icon,
        title: props.tooltip,
        'aria-label': props.tooltip,
        disabled: props.disabled,
        model: props.model,
        size: 'small',
        class: 'lex-submit-button',
        onClick: fire,
        // Keep focus in the editor after primary-button click so the
        // next keystroke after a send still routes to it.
        onMousedown: (event: MouseEvent) => event.preventDefault(),
      });
  },
});
