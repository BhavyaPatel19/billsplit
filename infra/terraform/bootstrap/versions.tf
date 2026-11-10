terraform {
  # `use_lockfile` (S3 native state locking, used by the main module) was
  # introduced in Terraform 1.10 and became GA in 1.11, so that is the floor.
  required_version = ">= 1.11"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  # Bootstrap state is intentionally local: this module creates the bucket that
  # holds every other module's state, so it cannot use that bucket itself. The
  # resulting terraform.tfstate is tiny and gitignored; if it is ever lost the
  # bucket can be re-adopted with `terraform import aws_s3_bucket.tfstate <name>`.
}
