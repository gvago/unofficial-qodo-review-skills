<script setup>
import { useId, useTemplateRef } from 'vue'
const input = useTemplateRef('booking')
const id = useId()
function focus() { input.value?.focus() }
</script>
<template><label :for="id">Reference</label><input :id="id" ref="booking"><button @click="focus">Focus</button></template>
