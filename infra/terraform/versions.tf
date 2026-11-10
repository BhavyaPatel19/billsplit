terraform {
  required_version = ">= 1.11"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.7"
    }
  }

  # Partial configuration: bucket and region come from backend.hcl (see backend.hcl.example),
  # which is produced by the bootstrap module and never committed.
  backend "s3" {
    key          = "prod/terraform.tfstate"
    encrypt      = true
    use_lockfile = true
  }
}
