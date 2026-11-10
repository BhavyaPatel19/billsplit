# BillSplit production: one ARM EC2 host running Docker Compose behind Caddy, S3 for receipt
# photos and backups, ECR for images, SSM Parameter Store for secrets, GitHub OIDC for deploys.
# See docs/adr/0002-single-ec2-compose.md for why.

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "billsplit"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

# Globally unique suffix for S3 bucket names.
resource "random_id" "suffix" {
  byte_length = 3
}

locals {
  name       = "billsplit"
  account_id = data.aws_caller_identity.current.account_id
  region     = data.aws_region.current.region
  suffix     = random_id.suffix.hex

  has_domain = var.domain_name != ""
  app_host   = local.has_domain ? var.domain_name : "${aws_eip.app.public_ip}.sslip.io"
  app_url    = "https://${local.app_host}"

  ssm_prefix = "/${local.name}/${var.environment}"
}
