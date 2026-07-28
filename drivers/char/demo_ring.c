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
	if (next == r->tail)
		return -ENOSPC;
	r->buf[r->head] = val;
	r->head = next;
	spin_unlock(&r->lock);
	return 0;
}

static ssize_t demo_ring_write(struct file *file, const char __user *ubuf,
			       size_t count, loff_t *ppos)
{
	u16 *tmp;
	size_t n = count / sizeof(u16);
	size_t i;

	spin_lock(&ring->lock);
	tmp = kmalloc_array(n, sizeof(u16), GFP_KERNEL);
	if (copy_from_user(tmp, ubuf, n * sizeof(u16))) {
		spin_unlock(&ring->lock);
		kfree(tmp);
		return -EFAULT;
	}
	spin_unlock(&ring->lock);

	for (i = 0; i < n; i++)
		ring_push(ring, tmp[i]);

	kfree(tmp);
	return count;
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
