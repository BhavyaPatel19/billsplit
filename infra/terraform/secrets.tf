# Secrets live in SSM Parameter Store as SecureStrings. Terraform creates each parameter with a
# placeholder and then ignores its value, so real values are set out-of-band and never pass
# through state or git:
#
#   aws ssm put-parameter --name /billsplit/prod/ANTHROPIC_API_KEY --type SecureString \
#     --value 'sk-ant-...' --overwrite
#
# The deploy workflow renders them into the host's .env from these names.

locals {
  secret_names = toset([
    "POSTGRES_PASSWORD",
    "BETTER_AUTH_SECRET",
    "ANTHROPIC_API_KEY",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
  ])
}

resource "aws_ssm_parameter" "secret" {
  for_each = local.secret_names

  name        = "${local.ssm_prefix}/${each.key}"
  description = "BillSplit ${var.environment} secret; set the real value with `aws ssm put-parameter --overwrite`."
  type        = "SecureString"
  value       = "CHANGE_ME"

  lifecycle {
    ignore_changes = [value]
  }
}

# Non-secret runtime configuration the deploy workflow also reads.
resource "aws_ssm_parameter" "config" {
  for_each = {
    APP_URL         = local.app_url
    RECEIPTS_BUCKET = aws_s3_bucket.receipts.bucket
    BACKUPS_BUCKET  = aws_s3_bucket.backups.bucket
    AWS_REGION      = local.region
    EMAIL_FROM      = var.email_from
  }

  name  = "${local.ssm_prefix}/${each.key}"
  type  = "String"
  value = each.value
}
