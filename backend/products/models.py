from django.db import models
import uuid

# Create your models here.
class Product(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255)
    origin = models.CharField(max_length=255)
    owner_wallet = models.CharField(max_length=255)
    created_at = models.DateTimeField(auto_now_add=True)

class ProductVersion(models.Model):
    product = models.ForeignKey(Product, on_delete=models.CASCADE)
    version = models.IntegerField()
    status = models.CharField(max_length=50)
    image_cid = models.CharField(max_length=255)
    hash = models.TextField()
    tx_hash = models.CharField(max_length=255)
    created_at = models.DateTimeField(auto_now_add=True)