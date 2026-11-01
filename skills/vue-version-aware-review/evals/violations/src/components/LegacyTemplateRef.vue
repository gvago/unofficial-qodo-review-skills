<script setup>
import { ref } from 'vue'
const field = ref(null)
function focus() { field.value?.focus() }
</script>
<template><label>Reference<input ref="field"></label><button @click="focus">Focus</button></template>
