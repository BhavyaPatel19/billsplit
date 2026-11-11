# Infrastructure

Everything BillSplit needs on AWS, as Terraform. One ARM EC2 host runs the Docker Compose stack behind Caddy (automatic HTTPS); S3 holds receipt photos and database backups; ECR holds images; SSM Parameter Store holds secrets; GitHub Actions deploys through an OIDC role, so no AWS keys ever live in GitHub. Design rationale: [ADR 0002](../docs/adr/0002-single-ec2-compose.md).

## Monthly cost (us-west-2, on demand)

| Item                               |     USD |
| ---------------------------------- | ------: |
| EC2 t4g.small (2 vCPU, 2 GB)       |  ~12.30 |
| 30 GB gp3 root volume              |   ~2.40 |
| Elastic IP (attached, in use)      |   ~3.60 |
| S3, ECR, CloudWatch Logs, SSM, SNS |     < 2 |
| **Total**                          | **~20** |

Plus Claude usage for receipt OCR (about $0.02 per receipt) and a domain if you buy one (~$10/year). The budget alarm defaults to $25.

## Hostname without buying a domain

Two free options, both with real Let's Encrypt HTTPS from Caddy:

- **sslip.io (zero setup, the default):** leave `domain_name` empty. The app is served at `https://<elastic-ip>.sslip.io`. The Elastic IP never changes, so the link is stable.
- **DuckDNS (readable name):** sign in at duckdns.org with GitHub or Google, claim a subdomain such as `billsplit`, and set its IP to the `public_ip` output. Then set `domain_name = "billsplit.duckdns.org"` and `create_route53_zone = false` and run `terraform apply` again so S3 CORS and the app URL pick it up.

Without your own domain, SES can only send from a single verified email address (for example your Gmail). That works for a demo, though some messages may land in spam.

## Prerequisites

```bash
brew install awscli terraform
aws configure            # an IAM user/role with admin on a fresh account is fine for the first apply
aws sts get-caller-identity
```

## 1. Bootstrap the state bucket (once)

```bash
cd infra/terraform/bootstrap
terraform init
terraform apply
terraform output -raw backend_hcl > ../backend.hcl
```

The bootstrap state file stays local and is gitignored; it only tracks the state bucket.

## 2. Apply the main module

```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars   # edit alert_email, email_from, domain
terraform init -backend-config=backend.hcl
terraform plan
terraform apply
```

Outputs you will need:

- `app_url`: where the app will be served (`https://<ip>.sslip.io` without a domain).
- `github_deploy_role_arn`: set as repository variable `AWS_DEPLOY_ROLE_ARN` in GitHub, together with `AWS_REGION` and `AWS_INSTANCE_ID` (from `instance_id`), `AWS_ECR_REGISTRY` (the host part of any `ecr_repository_urls` value) and `APP_HOST` (the hostname from `app_url`).
- `route53_name_servers`: if Terraform created the zone, set these at your registrar.

Confirm the SNS subscription email AWS sends to `alert_email`, otherwise alarms go nowhere.

## 3. Set the secrets

Terraform creates each parameter with the value `CHANGE_ME` and never touches it again:

```bash
P=/billsplit/prod
aws ssm put-parameter --name $P/POSTGRES_PASSWORD   --type SecureString --overwrite --value "$(openssl rand -base64 24)"
aws ssm put-parameter --name $P/BETTER_AUTH_SECRET  --type SecureString --overwrite --value "$(openssl rand -base64 32)"
aws ssm put-parameter --name $P/ANTHROPIC_API_KEY   --type SecureString --overwrite --value "sk-ant-..."
aws ssm put-parameter --name $P/GOOGLE_CLIENT_ID    --type SecureString --overwrite --value "..."
aws ssm put-parameter --name $P/GOOGLE_CLIENT_SECRET --type SecureString --overwrite --value "..."
```

The deploy workflow renders every parameter under the prefix into the host's `.env`.

## 4. Email

Verify the sender identity (the address in `email_from`, or the whole domain) in SES for the same region. New accounts start in the SES sandbox, which only delivers to verified addresses; request production access from the SES console when you want real users to get mail.

## 5. Deploy

Push to `main`. After CI passes, `.github/workflows/deploy.yml` builds arm64 images, pushes them to ECR and runs `docker compose pull && up -d --wait` on the host through SSM Run Command, then checks `https://<app_host>/api/healthz`. The first deploy also makes Caddy request the TLS certificate.

Shell on the host without SSH:

```bash
aws ssm start-session --target $(terraform output -raw instance_id)
sudo docker compose -f /opt/billsplit/compose.prod.yml ps
```

## Rollback

Re-run the deploy workflow with the previous commit SHA as the `image_tag` input (`workflow_dispatch`).

## Destroy

```bash
cd infra/terraform && terraform destroy
cd bootstrap && terraform destroy   # fails on the state bucket by design; empty and delete it by hand if you really mean it
```
