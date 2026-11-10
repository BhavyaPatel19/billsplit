# 0002. Single EC2 host running Docker Compose

Date: 2026-11-09. Status: accepted.

## Context

BillSplit must be live on AWS from the first week and stay cheap enough to run indefinitely as a portfolio project (target about $15/month). Traffic is a handful of friend groups. The options considered were ECS Fargate with RDS and an ALB (about $50 to $80/month, more Terraform), Lambda plus Aurora Serverless (cold starts, awkward for long OCR jobs and Postgres connection pooling), and one EC2 instance running the same Compose file used locally.

## Decision

Run web, api, worker, Postgres and Valkey as Docker Compose services on one ARM `t4g.small` instance behind Caddy, which terminates TLS with Let's Encrypt. Receipt photos live in S3, images in ECR, secrets in SSM Parameter Store. Terraform owns every AWS resource. GitHub Actions deploys by pushing images and running `docker compose pull && up -d --wait` through SSM Run Command, so no SSH port is open. Postgres is backed up nightly to S3 and the restore is tested weekly in CI.

## Consequences

- One host is a single point of failure. Acceptable for this product stage; the alarm and backup story covers data loss.
- The path to managed services is incremental: swap `DATABASE_URL` to RDS, then move services to ECS, without changing application code.
- Local and production run the same images and Compose topology, which keeps "works on my machine" bugs rare.
- Vertical scaling is a one-line instance type change; horizontal scaling is not available without the ECS move.
