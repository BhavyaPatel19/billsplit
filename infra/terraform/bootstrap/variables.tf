variable "aws_region" {
  description = "AWS region for the state bucket. Keep it identical to the main module's region."
  type        = string
  default     = "us-west-2"
}

variable "name_prefix" {
  description = "Prefix for the state bucket name. Final name: <prefix>-tfstate-<account id>."
  type        = string
  default     = "billsplit"
}

variable "tags" {
  description = "Tags applied to every resource via provider default_tags."
  type        = map(string)
  default = {
    Project     = "billsplit"
    Environment = "prod"
    ManagedBy   = "terraform"
  }
}
