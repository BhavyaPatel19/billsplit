# Architecture decision records

Short, dated notes on decisions that are hard to reverse. One file per decision, numbered in order.

| #    | Decision                                                      |
| ---- | ------------------------------------------------------------- |
| 0001 | Money is stored and computed as integer minor units (cents)   |
| 0002 | Single EC2 host running Docker Compose, not ECS or serverless |
| 0003 | Receipt extraction with Claude vision behind an OcrProvider   |
