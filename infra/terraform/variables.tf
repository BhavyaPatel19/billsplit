variable "aws_region" {
  description = "Region for every resource. Keep it identical to the bootstrap module."
  type        = string
  default     = "us-west-2"
}

variable "environment" {
  description = "Environment name used in tags and the SSM parameter prefix."
  type        = string
  default     = "prod"
}

variable "alert_email" {
  description = "Receives CloudWatch alarm and budget notifications (AWS emails a confirmation link first)."
  type        = string
}

variable "email_from" {
  description = "From address for transactional email, must be a verified SES identity, e.g. \"BillSplit <no-reply@example.com>\"."
  type        = string
}

variable "domain_name" {
  description = "Hostname for the app, e.g. billsplit.duckdns.org (free) or your own domain. Empty means https://<elastic-ip>.sslip.io."
  type        = string
  default     = ""
}

variable "create_route53_zone" {
  description = "Create a Route53 hosted zone for domain_name and point it at the host. Ignored when domain_name is empty."
  type        = bool
  default     = false
}

variable "extra_cors_origins" {
  description = "Additional origins allowed to upload receipts directly to S3 (e.g. http://localhost:3000 for testing against prod storage)."
  type        = list(string)
  default     = []
}

variable "instance_type" {
  description = "ARM (Graviton) instance type. t4g.small is about $12/month on demand."
  type        = string
  default     = "t4g.small"

  validation {
    condition     = can(regex("^(t4g|m7g|c7g|m8g|c8g)\\.", var.instance_type))
    error_message = "Use an arm64 instance family (t4g, m7g, c7g, m8g, c8g); the AMI and images are arm64."
  }
}

variable "root_volume_gb" {
  description = "Root volume size (gp3, encrypted). Holds Docker images and the Postgres data volume."
  type        = number
  default     = 30
}

variable "docker_compose_version" {
  description = "Docker Compose v2 plugin version installed on the host (pinned; see https://github.com/docker/compose/releases)."
  type        = string
  default     = "5.6.1"
}

variable "backup_retention_days" {
  description = "Days to keep nightly Postgres dumps in the backups bucket."
  type        = number
  default     = 30
}

variable "ecr_images_to_keep" {
  description = "Images retained per ECR repository (older ones expire)."
  type        = number
  default     = 10
}

variable "log_retention_days" {
  description = "CloudWatch Logs retention for the app log groups."
  type        = number
  default     = 30
}

variable "cpu_alarm_threshold" {
  description = "Host CPU percentage that triggers the CPU alarm after 15 minutes."
  type        = number
  default     = 80
}

variable "monthly_budget_usd" {
  description = "AWS Budgets monthly cost limit; alerts at 80% actual and 100% forecasted."
  type        = number
  default     = 25
}

variable "github_repository" {
  description = "GitHub repository (owner/name) allowed to assume the deploy role."
  type        = string
  default     = "BhavyaPatel19/billsplit"
}

variable "github_deploy_branch" {
  description = "Only workflows running on this branch may deploy."
  type        = string
  default     = "main"
}
