# Best practices: logging rules

## Rule: Do not call printf in library code; use log_msg() instead.
Rationale: Library output must be routable to the configured sink.
Severity: medium
Violation:
    printf("init done\n");
Compliant:
    log_msg(LOG_INFO, "init done");

## Rule: Pass a severity constant as the first argument of log_msg().
Rationale: Unleveled messages cannot be filtered at runtime.
Severity: low
Violation:
    log_msg("boot", "starting");
Compliant:
    log_msg(LOG_DEBUG, "starting");

## Rule: Do not log the contents of buffers received from the network.
Rationale: Network payloads may contain user data; logging them leaks it.
Severity: high
Violation:
    log_msg(LOG_DEBUG, "rx: %s", rx_buf);
Compliant:
    log_msg(LOG_DEBUG, "rx: %zu bytes", rx_len);
