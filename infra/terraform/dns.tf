# Optional. With no domain the app is reachable at https://<elastic-ip>.sslip.io, which Caddy
# can still get a Let's Encrypt certificate for. With a domain, either let Terraform create the
# hosted zone (then point the registrar at the name servers in `route53_name_servers`) or
# manage DNS elsewhere and just set an A record to `public_ip`.

resource "aws_route53_zone" "app" {
  count = local.has_domain && var.create_route53_zone ? 1 : 0

  name    = var.domain_name
  comment = "BillSplit ${var.environment}"
}

resource "aws_route53_record" "apex" {
  count = local.has_domain && var.create_route53_zone ? 1 : 0

  zone_id = aws_route53_zone.app[0].zone_id
  name    = var.domain_name
  type    = "A"
  ttl     = 300
  records = [aws_eip.app.public_ip]
}

resource "aws_route53_record" "www" {
  count = local.has_domain && var.create_route53_zone ? 1 : 0

  zone_id = aws_route53_zone.app[0].zone_id
  name    = "www.${var.domain_name}"
  type    = "CNAME"
  ttl     = 300
  records = [var.domain_name]
}
