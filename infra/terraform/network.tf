# The default VPC is enough for a single host; nothing else lives in this account.
data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
  filter {
    name   = "default-for-az"
    values = ["true"]
  }
}

resource "aws_security_group" "app" {
  name        = "${local.name}-app"
  description = "BillSplit host: HTTP/HTTPS from anywhere, no SSH (use SSM Session Manager)"
  vpc_id      = data.aws_vpc.default.id

  tags = { Name = "${local.name}-app" }
}

resource "aws_vpc_security_group_ingress_rule" "http" {
  security_group_id = aws_security_group.app.id
  description       = "HTTP (Caddy redirects to HTTPS and answers ACME challenges)"
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_ingress_rule" "https" {
  security_group_id = aws_security_group.app.id
  description       = "HTTPS"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_egress_rule" "all" {
  security_group_id = aws_security_group.app.id
  description       = "All outbound (ECR, S3, SES, Anthropic API, OS updates)"
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}
