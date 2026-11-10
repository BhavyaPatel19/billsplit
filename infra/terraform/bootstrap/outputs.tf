output "state_bucket_name" {
  description = "S3 bucket that stores the main module's Terraform state."
  value       = aws_s3_bucket.tfstate.bucket
}

output "state_bucket_region" {
  description = "Region of the state bucket."
  value       = var.aws_region
}

output "locking" {
  description = "How the main module locks its state."
  value       = "S3 native lockfile (use_lockfile = true); no DynamoDB table."
}

output "backend_hcl" {
  description = "Contents for infra/terraform/backend.hcl (the main module's partial backend config)."
  value       = <<-EOT
    bucket = "${aws_s3_bucket.tfstate.bucket}"
    region = "${var.aws_region}"
  EOT
}
