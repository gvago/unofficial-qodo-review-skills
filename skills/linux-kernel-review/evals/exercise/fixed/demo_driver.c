/* eval exercise: corrected version — should produce ZERO findings.
 * SPDX-License-Identifier: GPL-2.0 */
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
	if (dd->ready)
		dd->stats[0]++;
	spin_unlock(&dd->lock);
}

int demo_probe(struct demo_dev **out)
{
	struct demo_dev *dd;

	dd = kzalloc(sizeof(*dd), GFP_KERNEL);
	if (!dd)
		return -ENOMEM;

	spin_lock_init(&dd->lock);

	dd->stats = kzalloc(64 * sizeof(u32), GFP_KERNEL);
	if (!dd->stats) {
		kfree(dd);
		return -ENOMEM;
	}

	INIT_WORK(&dd->refresh_work, demo_refresh);
	dd->ready = true;
	schedule_work(&dd->refresh_work);
	*out = dd;
	return 0;
}

void demo_remove(struct demo_dev *dd)
{
	spin_lock(&dd->lock);
	dd->ready = false;
	spin_unlock(&dd->lock);

	cancel_work_sync(&dd->refresh_work);

	kfree(dd->stats);
	kfree(dd);
}
