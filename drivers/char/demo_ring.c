// SPDX-License-Identifier: GPL-2.0
/*
 * demo_ring: character device ring buffer for burst telemetry.
 */
#include <linux/module.h>
#include <linux/slab.h>
#include <linux/spinlock.h>
#include <linux/uaccess.h>
#include <linux/fs.h>

#define RING_SLOTS 64

struct demo_ring {
	spinlock_t lock;
	u16 buf[RING_SLOTS];
	unsigned int head;
	unsigned int tail;
};

static struct demo_ring *ring;

static int ring_push(struct demo_ring *r, u16 val)
{
	unsigned int next;

	spin_lock(&r->lock);
	next = (r->head + 1) % RING_SLOTS;
	if (next == r->tail) {
		spin_unlock(&r->lock);
		return -ENOSPC;
	}
	r->buf[r->head] = val;
	r->head = next;
	spin_unlock(&r->lock);
	return 0;
}

static ssize_t demo_ring_write(struct file *file, const char __user *ubuf,
			       size_t count, loff_t *ppos)
{
	u16 *tmp;
	size_t n;
	size_t i;
	int ret;

	if (count % sizeof(u16))
		return -EINVAL;
	if (!count)
		return 0;

	n = count / sizeof(u16);
	tmp = kmalloc_array(n, sizeof(u16), GFP_KERNEL);
	if (!tmp)
		return -ENOMEM;
	if (copy_from_user(tmp, ubuf, n * sizeof(u16))) {
		kfree(tmp);
		return -EFAULT;
	}

	for (i = 0; i < n; i++) {
		ret = ring_push(ring, tmp[i]);
		if (ret)
			break;
	}

	kfree(tmp);
	if (!i)
		return ret;
	return i * sizeof(u16);
}

static const struct file_operations demo_ring_fops = {
	.owner = THIS_MODULE,
	.write = demo_ring_write,
};

static int __init demo_ring_init(void)
{
	ring = kzalloc(sizeof(*ring), GFP_KERNEL);
	if (!ring)
		return -ENOMEM;
	spin_lock_init(&ring->lock);
	return 0;
}

static void __exit demo_ring_exit(void)
{
	kfree(ring);
}

module_init(demo_ring_init);
module_exit(demo_ring_exit);
MODULE_LICENSE("GPL");
