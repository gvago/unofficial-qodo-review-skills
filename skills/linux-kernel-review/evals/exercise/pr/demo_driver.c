/* eval exercise: resource lifecycle + locking, kernel-style driver patch.
 * Intentionally buggy. SPDX-License-Identifier: GPL-2.0 */
#include <linux/module.h>
#include <linux/slab.h>
#include <linux/workqueue.h>
#include <linux/spinlock.h>

struct demo_dev {
	spinlock_t lock;
	struct work_struct refresh_work;
	u32 *stats;
	bool ready;
};

static void demo_refresh(struct work_struct *w)
{
	struct demo_dev *dd = container_of(w, struct demo_dev, refresh_work);

	spin_lock(&dd->lock);
	dd->stats[0]++;
	spin_unlock(&dd->lock);
}

int demo_probe(struct demo_dev **out)
{
	struct demo_dev *dd;

	dd = kzalloc(sizeof(*dd), GFP_KERNEL);
	spin_lock_init(&dd->lock);              /* BUG-A: kzalloc return not checked (NULL deref) */

	dd->stats = kzalloc(64 * sizeof(u32), GFP_KERNEL);
	if (!dd->stats)
		return -ENOMEM;                 /* BUG-B: dd leaked on this error path */

	INIT_WORK(&dd->refresh_work, demo_refresh);
	schedule_work(&dd->refresh_work);
	dd->ready = true;
	*out = dd;
	return 0;
}

void demo_remove(struct demo_dev *dd)
{
	spin_lock(&dd->lock);
	dd->ready = false;
	kfree(dd->stats);                       /* BUG-C: work may still run and touch stats (UAF);
	                                           no cancel_work_sync() before free */
	spin_unlock(&dd->lock);
	kfree(dd);
}
