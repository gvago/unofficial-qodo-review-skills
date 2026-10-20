<script setup>
import { computed, reactive, watch } from 'vue'
const inventory = reactive({ selectedId: 0, entries: Array.from({ length: 50000 }, (_, id) => ({ id, stock: 10 })) })
const { selectedId } = inventory
const label = computed(() => `Selected ${selectedId}`)
watch(inventory, () => { document.title = `Selected ${inventory.selectedId}` }, { deep: true })
function selectNext() { inventory.selectedId++ }
</script>
<template><button @click="selectNext">{{ label }}</button></template>
