<script setup lang="ts">
/// Renders a user message bubble with inline attachment pills.
///
/// The composer extracts attachments in document order (pill position
/// N === attachments[N]) and its `getTextContent` puts the bare
/// filename in place of each pill. To reproduce the inline pill look
/// in the transcript we walk the text once, locate each attachment's
/// label in order, and emit alternating text segments + pills.
///
/// When the message has no attachments, fall back to `MessageContent`
/// for full markdown rendering. We only bypass markdown when pills
/// are present because most attachment-bearing prompts are short
/// natural-language references rather than heavily formatted markdown.

import { computed } from 'vue';
import MessageContent from '@/components/chat/MessageContent.vue';
import type { SendMessageAttachment } from '@/ipc/types';
import { labelForAttachment } from '@/lexical/AttachmentNode';
import { openAttachment } from '@/lib/openAttachment';

const props = defineProps<{
  text: string;
  label: string;
  attachments?: SendMessageAttachment[];
}>();

type Segment =
  | { kind: 'text'; value: string }
  | { kind: 'pill'; attachment: SendMessageAttachment };

const segments = computed<Segment[]>(() => {
  if (!props.attachments || props.attachments.length === 0) return [];

  const out: Segment[] = [];
  let cursor = 0;

  for (const a of props.attachments) {
    const label = labelForAttachment(a);
    const idx = props.text.indexOf(label, cursor);

    if (idx === -1) {
      // Filename wasn't found in the text — could happen if the user
      // edited the message after sending. Emit the pill anyway so the
      // attachment is still visible somewhere.
      out.push({ kind: 'pill', attachment: a });
      continue;
    }

    if (idx > cursor) {
      out.push({ kind: 'text', value: props.text.slice(cursor, idx) });
    }

    out.push({ kind: 'pill', attachment: a });
    cursor = idx + label.length;
  }

  if (cursor < props.text.length) {
    out.push({ kind: 'text', value: props.text.slice(cursor) });
  }

  return out;
});

function iconClass(a: SendMessageAttachment): string {
  if (a.type === 'directory') return 'pi-folder';

  if (a.type === 'selection') return 'pi-bookmark';

  if (a.type === 'commandResult') return 'pi-terminal';

  if (a.type === 'blob' && (a.mimeType ?? '').startsWith('image/')) return 'pi-image';

  return 'pi-file';
}
</script>

<template>
  <MessageContent
    v-if="!attachments || attachments.length === 0"
    :text="text"
    :label="label"
  />
  <p
    v-else
    class="user-message-body"
    :aria-label="label"
  >
    <template
      v-for="(seg, i) in segments"
      :key="i"
    >
      <span
        v-if="seg.kind === 'text'"
        class="user-text-seg"
        >{{ seg.value }}</span
      >
      <button
        v-else
        type="button"
        class="composer-attachment-pill user-attachment-pill"
        :data-attachment-type="seg.attachment.type"
        :data-attachment-kind="
          seg.attachment.type === 'commandResult'
            ? 'command-result'
            : seg.attachment.type === 'blob' && (seg.attachment.mimeType ?? '').startsWith('image/')
              ? 'image'
              : undefined
        "
        :title="labelForAttachment(seg.attachment)"
        :aria-label="`Open attachment ${labelForAttachment(seg.attachment)}`"
        @click="openAttachment(seg.attachment)"
      >
        <i
          :class="`pi ${iconClass(seg.attachment)} composer-attachment-pill-icon`"
          aria-hidden="true"
        />
        <span class="composer-attachment-pill-label">{{ labelForAttachment(seg.attachment) }}</span>
      </button>
    </template>
  </p>
</template>

<style scoped>
.user-message-body {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.45;
}

.user-text-seg {
  white-space: pre-wrap;
}

.user-attachment-pill {
  cursor: pointer;
  font-family: inherit;
}

.user-attachment-pill:focus-visible {
  outline: 2px solid var(--p-primary-color);
  outline-offset: 1px;
}
</style>
