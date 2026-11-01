<script setup>
import { computed } from 'vue'
const { count } = defineProps({ count: Number })
const doubled = computed(() => count * 2)
</script>
<template><output>{{ doubled }}</output></template>
