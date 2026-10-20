<script setup>
import { ref } from 'vue'
const rows = ref([{ id: 'a', name: 'North', active: true }, { id: 'b', name: 'South', active: true }])
function reverse() { rows.value.reverse() }
</script>
<template>
  <section>
    <button @click="reverse">Reverse</button>
    <input v-for="(row, index) in rows" :key="index" :default-value="row.name" :aria-label="row.name">
    <p v-for="row in rows" v-if="row.active" :key="row.id">{{ row.name }}</p>
  </section>
</template>
