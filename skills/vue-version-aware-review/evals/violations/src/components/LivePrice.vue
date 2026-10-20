<script setup>
import { computed } from 'vue'
const { price } = defineProps({ price: { type: Number, required: true } })
const total = computed(() => price * 2)
</script>
<template><output>{{ total }}</output></template>
