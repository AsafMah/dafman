<script setup lang="ts">
import { ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import Button from "primevue/button";
import Card from "primevue/card";
import Message from "primevue/message";

const result = ref("");
const isLoading = ref(false);
const isError = ref(false);

async function createClient() {
  isLoading.value = true;
  isError.value = false;

  try {
    result.value = await invoke<string>("create_client");
  } catch (error) {
    isError.value = true;
    result.value = `Error: ${String(error)}`;
  } finally {
    isLoading.value = false;
  }
}
</script>

<template>
  <main class="container">
    <Card class="panel">
      <template #title>Copilot Client</template>
      <template #content>
        <div class="content">
          <Button
            type="button"
            :loading="isLoading"
            :label="isLoading ? 'Creating client...' : 'Create Copilot Client'"
            icon="pi pi-play"
            @click="createClient"
          />
          <Message v-if="result" :severity="isError ? 'error' : 'success'">
            {{ result }}
          </Message>
        </div>
      </template>
    </Card>
  </main>
</template>

<style scoped>
.container {
  min-height: 100vh;
  display: grid;
  place-content: center;
  padding: 1rem;
}

.panel {
  width: min(500px, 92vw);
}

.content {
  display: grid;
  gap: 1rem;
}

</style>