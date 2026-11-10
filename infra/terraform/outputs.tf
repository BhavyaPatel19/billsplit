output "app_url" {
  description = "Where the app is served. Caddy obtains the certificate on first start."
  value       = local.app_url
}

output "public_ip" {
  description = "Elastic IP of the host (point an external DNS A record here if you manage DNS elsewhere)."
  value       = aws_eip.app.public_ip
}

output "instance_id" {
  description = "EC2 instance id; used by the deploy workflow's SSM Run Command and for `aws ssm start-session`."
  value       = aws_instance.app.id
}

output "ecr_repository_urls" {
  description = "Image repositories, keyed by app."
  value       = { for k, r in aws_ecr_repository.app : k => r.repository_url }
}

output "receipts_bucket" {
  value = aws_s3_bucket.receipts.bucket
}

output "backups_bucket" {
  value = aws_s3_bucket.backups.bucket
}

output "github_deploy_role_arn" {
  description = "Set as the AWS_DEPLOY_ROLE_ARN repository variable in GitHub."
  value       = aws_iam_role.github_deploy.arn
}

output "ssm_parameter_prefix" {
  description = "Prefix of the SecureString parameters to fill in with real secrets."
  value       = local.ssm_prefix
}

output "secret_parameter_names" {
  value = [for p in aws_ssm_parameter.secret : p.name]
}

output "alerts_topic_arn" {
  value = aws_sns_topic.alerts.arn
}

output "route53_name_servers" {
  description = "Only when Terraform created the hosted zone: set these at your registrar."
  value       = local.has_domain && var.create_route53_zone ? aws_route53_zone.app[0].name_servers : []
}
