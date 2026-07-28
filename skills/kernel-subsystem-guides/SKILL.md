---
name: kernel-subsystem-guides
description: "Use when a Linux kernel PR diff matches a known subsystem (mm, block, net, btrfs, io_uring, KVM, DRM, USB, scheduler, and 60+ more), router into per-subsystem invariant guides from Chris Mason's masoncl/review-prompts knowledge base; load every guide whose trigger row matches before analysis. Part of the linux-kernel-review suite."
license: MIT
metadata:
  author: Sashiko contributors / Chris Mason
  adapted_by: gvago
  source: https://github.com/masoncl/review-prompts (MIT) via https://github.com/sashiko-dev/sashiko
  variant: review
  version: 1.0.0
---

# kernel-subsystem-guides

Per-subsystem invariants, API contracts, and bug patterns (Sashiko's
shared-context knowledge base). This skill is a router: match the diff
against the trigger table and load EVERY matching guide from
references/subsystem/ before analysis. A change can match multiple rows , 
code in arch/arm64/kvm/hyp/ matches ARM64, KVM, ARM64 KVM, and ARM64 Hyp,
and all four apply.

## Trigger table

Triggers are path fragments, function-call prefixes, and symbol regexes.

| Subsystem | Triggers | Guide |
|-----------|----------|------|
| Networking Core | net/, skb_, sockets, xfrm, dst_, sock_put, release_sock, pskb_may_pull, SNMP_*_STATS | networking-core.md |
| Networking Drivers | drivers/net/, ethtool_ops, net_device_ops | networking-drivers.md |
| Netlink | genl_, nla_, NLA_, NLM_F_, nlmsg_, netlink_callback, Documentation/netlink/specs/ | netlink.md |
| MM Page Tables | pte_*, pmd_*, pud_*, set_pte, ptep_*, tlb_*, mm/memory.c, mm/mprotect.c, mm/pagewalk.c | mm-pagetable.md |
| Alignment Helpers | ALIGN, ALIGN_DOWN, IS_ALIGNED, PAGE_ALIGN, pageblock_* | alignment.md |
| MM Folio/Page Cache | folio_*, page_folio, compound_head, filemap_*, xa_*, xas_*, mm/filemap.c | mm-folio.md |
| MM Large Folios/THP | huge_memory, hugetlb, split_huge_*, hstate, mm/huge_memory.c, mm/hugetlb.c | mm-largepage.md |
| MM VMA | vma_*, mmap_*, vm_area_struct, vm_flags, anon_vma, maple_tree, mm/vma.c, mm/mmap.c | mm-vma.md |
| MM Allocation | alloc_pages, __GFP_*, kmalloc, kmem_cache_*, slub, vmalloc, mempool, mm/page_alloc.c | mm-alloc.md |
| MM Reclaim/Swap | vmscan, shrink_*, lru_*, swap_*, shmem_*, mem_cgroup_*, migrate_*, mm/vmscan.c | mm-reclaim.md |
| VFS | inode, dentry, vfs_, fs/*.c | vfs.md |
| LEDs | drivers/leds/, led_classdev_register | leds.md |
| Locking | spin_lock*, mutex_*, rwsem*, seqlock*, *seqcount* | locking.md |
| Scheduler | kernel/sched/, sched_, schedule, *wakeup* | scheduler.md |
| Timers | timer_list, timer_setup, mod_timer, del_timer, hrtimer, delayed_work | timers.md |
| BPF | kernel/bpf/, tools/lib/bpf/, bpf, verifier | bpf.md |
| BTF Fields | map_check_btf, bpf_obj_free_fields, BPF_SPIN_LOCK, BPF_TIMER, BPF_KPTR | btf.md |
| Libbpf API | tools/lib/bpf/, LIBBPF_API, libbpf_err | libbpf.md |
| RCU | rcu*, call_rcu, synchronize_rcu, kfree_rcu | rcu.md |
| Encryption | crypto, fscrypt_ | fscrypt.md |
| Tracing | trace_, tracepoints | tracing.md |
| Workqueue | kernel/workqueue.c, work_struct | workqueue.md |
| Syscalls | SYSCALL_DEFINE, copy_from_user, copy_to_user, get_user, put_user | syscall.md |
| btrfs | fs/btrfs/ | btrfs.md |
| DAX | dax operations | dax.md |
| Block/NVMe | block layer, nvme | block.md |
| DRM/GPU | drivers/gpu/drm/, drm_atomic_, drm_crtc_, hwseq | drm.md |
| Media/V4L2 | drivers/media/, v4l2_subdev_, MEDIA_BUS_FMT_ | media.md |
| NFSD | fs/nfsd/*, fs/lockd/* | nfsd.md |
| SunRPC | net/sunrpc/* | sunrpc.md |
| io_uring | io_uring/, io_uring_, io_ring_, IORING_ | io_uring.md |
| FUSE | fs/fuse/, fuse_uring_, FUSE_OVER_IO_URING | fuse.md |
| Cleanup API | __free, guard(, scoped_guard, DEFINE_FREE, DEFINE_GUARD, no_free_ptr | cleanup.md |
| Power Domains | drivers/pmdomain/, pm_genpd_, of_genpd_ | pmdomain.md |
| PM Runtime | pm_runtime_, __pm_runtime_, rpm_idle, rpm_suspend | pm.md |
| Sysfs | fs/sysfs/, sysfs_create_group, attribute_group, is_visible | sysfs.md |
| CXL | drivers/cxl/, cxl_ | cxl.md |
| Bluetooth | net/bluetooth/, hci_, HCI_LE_ADV | bluetooth.md |
| TTY/Serial | drivers/tty/, uart_add_one_port, uart_ops, serial_core | tty.md |
| PCI | drivers/pci/, pci_epc_, pci_epf_, pci_ep_ | pci.md |
| SMB/ksmbd | fs/smb/server/, ksmbd_, smb_direct_ | smb-ksmbd.md |
| Open Firmware (DT) | drivers/of/, of_node, of_find_, of_get_, of_node_put | of.md |
| Perf Tools | tools/perf/, openat, fdopendir, closedir | perf.md |
| MFD | drivers/mfd/, mfd_add_devices, mfd_cell | mfd.md |
| MIPS | arch/mips/, tlb_probe, write_c0_entryhi, TLBP, TLBR, TLBWI | mips.md |
| hwmon | drivers/hwmon/, hwmon_* | hwmon.md |
| Wireless/mac80211 | drivers/net/wireless/, net/mac80211/, BSS_CHANGED_ | wireless.md |
| Selftests | tools/testing/selftests/, TEST_PROGS, TEST_GEN_FILES | selftests.md |
| DT Bindings | Documentation/devicetree/bindings/, *.yaml in devicetree | dt-bindings.md |
| USB Storage | drivers/usb/storage/, UNUSUAL_DEV, USB_SC_, USB_PR_ | usb-storage.md |
| ATA/libata | drivers/ata/, ata_dev_, ata_port_, ATA_QUIRK_ | ata.md |
| I/O Accessors | writesl, readsl, writesw, readsw, __raw_writel, __raw_readl, FIFO | io-accessors.md |
| Kconfig | Kconfig, config , select , depends on , tristate | kconfig.md |
| Build System | Kbuild, Makefile, scripts/, gnu11, -funsigned-char | build.md |
| I2C | drivers/i2c/, i2c_transfer, i2c_master_send, i2c_smbus_ | i2c.md |
| HID | drivers/hid/, hid_device, hid_driver, hid_hw_start | hid.md |
| Input | drivers/input/, input_dev, input_handler, input_register_ | input.md |
| Objtool | tools/objtool/, INSN_BUG, INSN_TRAP, decode.c | objtool.md |
| KHO (Kexec Handover) | kho_, kho_is_enabled, register_kho_notifier | kho.md |
| Rust | any Rust code | rust.md |
| KVM | virt/kvm/, include/linux/kvm*, kvm_ | kvm.md |
| ARM64 | arch/arm64/, sysreg | arm64.md |
| ARM64 KVM (EL1/Host) | arch/arm64/kvm/ | kvm-arm64.md |
| ARM64 Hyp (EL2) | arch/arm64/kvm/hyp/, __hyp_, pkvm/ | hyp-arm64.md |

## Mandatory check

When the diff contains call_rcu(), synchronize_rcu(), or kfree_rcu():
IMMEDIATELY load references/subsystem/rcu.md and verify whether removal
from data structures happens BEFORE or AFTER the call_rcu().

## Optional

- subjective-review.md, subjective general assessment, only when
  explicitly requested.

## Sourcing

Trigger table and all guides reproduced from masoncl/review-prompts (MIT,
Chris Mason), as consumed by Sashiko (Apache-2.0).
