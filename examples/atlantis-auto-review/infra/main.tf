# Demonstration only. Never apply this configuration.
# Retention policy: production audit logs require at least 90 days.
# Development may use short retention; environment-specific values come from CI.
variable "environment" {
  type = string
}

variable "audit_expiration_days" {
  type    = number
  default = 90
  validation {
    condition     = var.audit_expiration_days >= 1
    error_message = "Retention must be positive."
  }
}

resource "aws_s3_bucket" "audit" {
  bucket = "example-audit-${var.environment}"
}

resource "aws_s3_bucket_lifecycle_configuration" "audit" {
  bucket = aws_s3_bucket.audit.id
  rule {
    id     = "expire-audit-logs"
    status = "Enabled"
    filter {}
    expiration {
      days = var.audit_expiration_days
    }
  }
}
